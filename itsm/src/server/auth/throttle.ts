// Failed sign-ins counted in sm_auth_throttle (every server instance sees the same counters): per login name of a
// directory source, per client address and per source. A login name that fails the organisation's threshold times in
// its window is locked here for its minutes — the domain controllers are not asked again, so a password-spraying run
// neither reaches them nor locks the person's domain account — and an address that fails across many names is held
// back too. Unknown login names are counted like real ones (a lockout tells nothing about an account). Crossing a
// threshold tells the organisation's administrators (at most once an hour per key) through the notification service.
import type { Queryable } from "../db";
import { sha256 } from "./password";

export type ThrottleKind = "login" | "ip" | "source";

export interface ThrottleKey {
  kind: ThrottleKind;
  org_id: string | null;
  /** what administrators see: the login name or the address (never a password) */
  subject: string;
  /** what makes the key unique (source + login, the address, the source) */
  scope: string;
}

const keyOf = (k: ThrottleKey) => `${k.kind}:${sha256(`${k.org_id ?? "-"}|${k.scope.toLowerCase()}`).slice(0, 40)}`;

export const loginKey = (orgId: string, sourceId: string, login: string): ThrottleKey => ({ kind: "login", org_id: orgId, subject: login.toLowerCase().slice(0, 200), scope: `${sourceId}|${login}` });
export const ipKey = (orgId: string | null, ip: string): ThrottleKey => ({ kind: "ip", org_id: orgId, subject: ip.slice(0, 80), scope: ip });
export const sourceKey = (orgId: string, sourceId: string, name: string): ThrottleKey => ({ kind: "source", org_id: orgId, subject: name.slice(0, 200), scope: sourceId });

/** Until when a key is locked (null: it is not). */
export async function lockedUntil(q: Queryable, k: ThrottleKey): Promise<Date | null> {
  const r = await q.one<{ locked_until: string | Date | null }>(`select locked_until from sm_auth_throttle where key = $1`, [keyOf(k)]);
  const until = r?.locked_until ? new Date(r.locked_until) : null;
  return until && until.getTime() > Date.now() ? until : null;
}

export interface FailureResult {
  failures: number;
  /** the key became locked by this failure */
  locked: boolean;
  /** administrators should hear about it now (first time in the hour) */
  notify: boolean;
}

/** Count a failure; lock the key once it reaches `threshold` failures within `windowMinutes`. */
export async function recordFailure(q: Queryable, k: ThrottleKey, threshold: number, windowMinutes: number, lockMinutes: number): Promise<FailureResult> {
  const r = await q.one<{ failures: number; locked_until: string | Date | null; was_locked: boolean; notified_at: string | Date | null }>(
    `insert into sm_auth_throttle as t (key, org_id, kind, subject, failures, window_start, updated_at)
     values ($1, $2, $3, $4, 1, now(), now())
     on conflict (key) do update set
       failures = case when t.window_start < now() - make_interval(mins => $5::int) then 1 else t.failures + 1 end,
       window_start = case when t.window_start < now() - make_interval(mins => $5::int) then now() else t.window_start end,
       subject = excluded.subject,
       updated_at = now()
     returning failures, locked_until, (locked_until is not null and locked_until > now()) as was_locked, notified_at`,
    [keyOf(k), k.org_id, k.kind, k.subject, windowMinutes],
  );
  const failures = Number(r?.failures ?? 1);
  if (failures < threshold || r?.was_locked) return { failures, locked: false, notify: false };
  const notify = !r?.notified_at || Date.now() - new Date(r.notified_at).getTime() > 3600_000;
  await q.query(
    `update sm_auth_throttle set locked_until = now() + make_interval(mins => $2::int)${notify ? ", notified_at = now()" : ""} where key = $1`,
    [keyOf(k), lockMinutes],
  );
  return { failures, locked: true, notify };
}

/** A successful sign-in clears its login name's counter. */
export async function clearFailures(q: Queryable, k: ThrottleKey): Promise<void> {
  await q.query(`delete from sm_auth_throttle where key = $1`, [keyOf(k)]);
}

/** Count failures of a whole source (password spraying across many names); true when administrators should hear now. */
export async function sourceFailure(q: Queryable, k: ThrottleKey, threshold: number, windowMinutes: number): Promise<boolean> {
  const r = await recordFailure(q, k, threshold, windowMinutes, 1);
  return r.notify;
}

export interface LockRow {
  key: string;
  kind: ThrottleKind;
  subject: string | null;
  failures: number;
  locked_until: string | null;
  updated_at: string;
}

/** Locked login names and addresses of an organisation (the security page). */
export async function listLocks(q: Queryable, orgId: string): Promise<LockRow[]> {
  return q.query<LockRow>(
    `select key, kind, subject, failures, locked_until, updated_at from sm_auth_throttle
     where org_id = $1 and kind in ('login', 'ip') and locked_until is not null and locked_until > now() order by updated_at desc limit 200`,
    [orgId],
  );
}

/** «رفع قفل»: an administrator lets a login name or address try again. */
export async function unlock(q: Queryable, orgId: string, key: string): Promise<boolean> {
  const r = await q.one(`delete from sm_auth_throttle where key = $1 and org_id = $2 returning key`, [key, orgId]);
  return !!r;
}
