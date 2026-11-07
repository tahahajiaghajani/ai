// Security events (sm_security_events): sign-ins (failed ones too), password changes and resets,
// member and role changes, platform-admin grants, support sessions, business status, AI key changes.
// Other streams record their own events with `securityEvent(db, e)`. It never throws: a lost log line
// must not fail the request. Passwords, keys, tokens and session ids are never recorded.
import type { Context } from "hono";
import type { Queryable } from "../../db";
import { likeContains } from "../../db";
import { clientIp } from "../../auth/session";
import { uuidv7 } from "@shared/id";

export type SecurityEventKind =
  | "sign_in" // ok false: data.reason = unknown_account | wrong_password | disabled | rate_limited
  | "sign_up"
  | "password_change" // by the account itself (ok false: wrong current password)
  | "password_reset" // by a business manager or the platform admin (data.scope = org | platform, data.reason)
  | "password_recover" // with the recovery code (ok false: wrong code)
  | "sessions_revoked" // «خروج از همهٔ دستگاه‌ها»
  | "member_added"
  | "member_changed" // role, per-area overrides or activation (data.changes)
  | "platform_admin" // granted or revoked (data.granted, data.by = admin | env)
  | "user_disabled"
  | "user_enabled"
  | "support_start"
  | "support_end"
  | "org_status"
  | "ai_key" // AI connection key added, replaced or removed (stream B)
  | "price_key" // key of a custom price source added, replaced or removed (data.board, data.origin, data.runtime)
  | (string & {});

export interface SecurityEventInput {
  kind: SecurityEventKind;
  ok?: boolean;
  user_id?: string | null;
  email?: string | null;
  org_id?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  data?: Record<string, unknown> | null;
}

/** Events older than this are removed (at most once every few hours per server instance). */
export const SECURITY_RETENTION_DAYS = 365;
let lastPrune = 0;

export async function securityEvent(db: Queryable, e: SecurityEventInput): Promise<void> {
  const inTx = "inTx" in db && (db as { inTx?: boolean }).inTx === true;
  const insert = () =>
    db.query(
      `insert into sm_security_events (id, kind, ok, user_id, email, org_id, ip, user_agent, data) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uuidv7(), e.kind, e.ok ?? true, e.user_id ?? null, e.email?.toLowerCase().slice(0, 200) ?? null, e.org_id ?? null, e.ip?.slice(0, 80) ?? null, e.user_agent?.slice(0, 300) ?? null, e.data ?? null],
    );
  try {
    if (inTx) {
      // a failed statement would abort the caller's transaction: keep the insert in a savepoint
      await db.query("savepoint sm_security_event");
      try {
        await insert();
        await db.query("release savepoint sm_security_event");
      } catch {
        await db.query("rollback to savepoint sm_security_event");
      }
      return;
    }
    await insert();
    if (Date.now() - lastPrune > 6 * 3600_000) {
      lastPrune = Date.now();
      await db.query(`delete from sm_security_events where at < now() - make_interval(days => $1)`, [SECURITY_RETENTION_DAYS]);
    }
  } catch {
    // never fail the request for a log line
  }
}

/** Where a request came from, for an event. */
export function requestMeta(c: Context): { ip: string; user_agent: string | null } {
  return { ip: clientIp(c), user_agent: c.req.header("user-agent") ?? null };
}

// failed sign-ins that hit the rate limit are logged once per address and account per window
const limited = new Map<string, number>();
export function firstRateLimitHit(key: string, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const until = limited.get(key);
  if (until && until > now) return false;
  limited.set(key, now + windowMs);
  if (limited.size > 2000) for (const [k, v] of limited) if (v < now) limited.delete(k);
  return true;
}

export interface SecurityEventRow {
  id: string;
  at: string;
  kind: string;
  ok: boolean;
  user_id: string | null;
  email: string | null;
  org_id: string | null;
  ip: string | null;
  user_agent: string | null;
  data: Record<string, unknown> | null;
  user_name: string | null;
  org_name: string | null;
}

export interface SecurityEventFilter {
  kind?: string | null;
  ok?: boolean | null;
  q?: string | null;
  user_id?: string | null;
  org_id?: string | null;
  /** events strictly older than this time (the previous page's last `at`) */
  before?: string | null;
  limit?: number;
}

export async function listSecurityEvents(q: Queryable, f: SecurityEventFilter = {}): Promise<SecurityEventRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.kind) add("e.kind = ?", f.kind);
  if (f.ok !== undefined && f.ok !== null) add("e.ok = ?", f.ok);
  if (f.user_id) add("e.user_id = ?", f.user_id);
  if (f.org_id) add("e.org_id = ?", f.org_id);
  if (f.before) add("e.at < ?", f.before);
  if (f.q?.trim()) {
    params.push(likeContains(f.q.trim()));
    const p = `$${params.length}`;
    where.push(`(e.email ilike ${p} or e.ip ilike ${p} or u.full_name ilike ${p} or o.name ilike ${p})`);
  }
  params.push(Math.min(500, Math.max(1, f.limit ?? 100)));
  return q.query<SecurityEventRow>(
    `select e.id, e.at, e.kind, e.ok, e.user_id, e.email, e.org_id, e.ip, e.user_agent, e.data, u.full_name as user_name, o.name as org_name
     from sm_security_events e
     left join sm_users u on u.id = e.user_id
     left join sm_orgs o on o.id = e.org_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by e.at desc, e.id desc
     limit $${params.length}`,
    params,
  );
}
