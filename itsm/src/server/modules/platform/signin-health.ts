// Sign-in health for the platform owner («سلامت سرور» of the server edition): counts only — failed sign-ins and
// lockouts in the last hour across the installation, and the last domain-controller connection test of each directory
// source (organisation and source names, the result and its message). No account names, addresses or records of an
// organisation: the platform owner's role sees the installation's health, not who tried to sign in (that stays in each
// organisation's «گزارش ورودها»).
import type { Queryable } from "../../db";
import { securityEvent } from "./security";

export interface SignInHealth {
  failed_1h: number;
  succeeded_1h: number;
  locked_1h: number;
  sources: { org: string; source: string; at: string; ok: boolean; message: string }[];
}

/** Record a directory source's connection test (the latest one per source is shown on «سلامت سرور»). */
export async function recordDirectoryTest(db: Queryable, e: { org_id: string; user_id: string; source_id: string; ok: boolean; message: string }): Promise<void> {
  await securityEvent(db, { kind: "directory_test", ok: e.ok, user_id: e.user_id, org_id: e.org_id, data: { source: e.source_id, message: e.message.slice(0, 300) } });
}

export async function signInHealth(db: Queryable): Promise<SignInHealth> {
  const counts = await db
    .one<{ failed: number; ok: number }>(
      `select count(*) filter (where not ok)::int as failed, count(*) filter (where ok)::int as ok
         from sm_security_events where kind = 'sign_in' and at > now() - interval '1 hour'`,
    )
    .catch(() => null);
  // a lock that was in force at some time during the last hour (local and directory sign-ins, names and addresses)
  const locked = await db.one<{ n: number }>(`select count(*)::int as n from sm_auth_throttle where locked_until > now() - interval '1 hour'`).catch(() => null);
  const sources = await db
    .query<{ org: string; source: string; at: string | Date; ok: boolean; message: string | null }>(
      `select distinct on (e.data->>'source') o.name as org, s.name as source, e.at, e.ok, e.data->>'message' as message
         from sm_security_events e
         join sm_orgs o on o.id = e.org_id and o.deleted_at is null
         join sm_directory_sources s on s.org_id = e.org_id and s.id::text = e.data->>'source' and s.deleted_at is null
        where e.kind = 'directory_test' and e.at > now() - interval '90 days'
        order by e.data->>'source', e.at desc`,
    )
    .catch(() => []);
  return {
    failed_1h: counts?.failed ?? 0,
    succeeded_1h: counts?.ok ?? 0,
    locked_1h: locked?.n ?? 0,
    sources: sources
      .map((r) => ({ org: r.org, source: r.source ?? "", at: new Date(r.at).toISOString(), ok: r.ok, message: r.message ?? "" }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50),
  };
}
