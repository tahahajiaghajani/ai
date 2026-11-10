// Sign-in of the demo pack's people (docs/DEMO_FA.md). The personas share one password the presenter shows, so they
// reach their organisation only while one of its administrators has turned «ورود حساب‌های نمایشی» on — off by
// default, and off for good once the pack is purged. (An organisation whose only members are the pack's people, which
// cannot happen through the console, needs no switch.) The personas never hold an administrator's role.
import type { Queryable } from "../../db";

/** The refusal message, or null when the account may reach the organisation. */
export async function demoSignInRefusal(q: Queryable, user: { id: string; prefs?: Record<string, unknown> | null }, orgId: string): Promise<string | null> {
  if (!user.prefs || user.prefs.demo_org !== orgId) return null;
  return (await demoSignInAllowed(q, orgId)) ? null : DEMO_SIGNIN_OFF;
}

export const DEMO_SIGNIN_OFF = "ورود با حساب‌های نمایشی در این سازمان خاموش است؛ مدیر سازمان می‌تواند آن را در «داده‌های نمایشی» برای زمان ارائه روشن کند";

/** Do the organisation's administrators allow the pack's people to sign in now? */
export async function demoSignInAllowed(q: Queryable, orgId: string): Promise<boolean> {
  const pack = await q.one<{ on: boolean; real: boolean }>(
    `select coalesce((p.options ->> 'signin')::boolean, false) as on,
            exists (select 1 from sm_org_members m join sm_users u on u.id = m.user_id
                     where m.org_id = p.org_id and m.deleted_at is null and coalesce(u.prefs ->> 'demo_org', '') <> p.org_id::text) as real
       from sm_demo_packs p where p.org_id = $1 and p.state in ('loading', 'loaded')`,
    [orgId],
  );
  if (!pack) return false;
  return pack.on || !pack.real;
}

/** Turn demo sign-in on or off (an administrator's decision; the console asks for it). */
export async function setDemoSignIn(q: Queryable, orgId: string, on: boolean): Promise<boolean> {
  const r = await q.query(`update sm_demo_packs set options = options || jsonb_build_object('signin', $2::boolean), updated_at = now() where org_id = $1 and state in ('loading', 'loaded') returning org_id`, [orgId, on]);
  if (!on) await q.query(`delete from sm_sessions where user_id in (select id from sm_users where prefs ->> 'demo_org' = $1::text)`, [orgId]);
  return r.length > 0;
}

/** The demo account behind an email, with the organisation it belongs to (null for any other account). */
export async function demoOrgOf(q: Queryable, userId: string): Promise<string | null> {
  const r = await q.one<{ org: string | null }>(`select prefs ->> 'demo_org' as org from sm_users where id = $1`, [userId]);
  return r?.org ?? null;
}
