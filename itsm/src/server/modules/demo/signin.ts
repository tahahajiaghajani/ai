// Sign-in of the demo pack's people (docs/DEMO_FA.md). The personas share one password the presenter shows, so they
// reach their organisation only while one of its administrators has turned «ورود حساب‌های نمایشی» on — off by
// default, and off for good once the pack is purged. (An organisation whose only members are the pack's people, which
// cannot happen through the console, needs no switch.) The personas never hold an administrator's role.
import type { Queryable } from "../../db";
import { hashPassword, readableCode } from "../../auth/password";

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

/**
 * Turn demo sign-in on or off (an administrator's decision; the console asks for it). On: the personas get a fresh
 * shared password, kept with the pack only while sign-in is on (the console shows it to administrators). Off: the
 * password is forgotten and the personas' sessions end.
 */
export async function setDemoSignIn(q: Queryable, orgId: string, on: boolean): Promise<boolean> {
  // once the load has ended (a running load keeps its own copy of the pack's progress)
  const pack = await q.one(`select 1 from sm_demo_packs where org_id = $1 and state = 'loaded'`, [orgId]);
  if (!pack) return false;
  if (on) {
    const password = readableCode(3, 4);
    const hash = await hashPassword(password);
    await q.query(`update sm_users set password_hash = $2 where prefs ->> 'demo_org' = $1::text and password_hash is not null`, [orgId, hash]);
    await q.query(
      `update sm_demo_packs set options = options || '{"signin": true}'::jsonb,
              progress = jsonb_set(progress, '{memo}', coalesce(progress -> 'memo', '{}'::jsonb) || jsonb_build_object('password', $2::text)), updated_at = now()
        where org_id = $1`,
      [orgId, password],
    );
  } else {
    await q.query(`update sm_demo_packs set options = options || '{"signin": false}'::jsonb, progress = progress #- '{memo,password}', updated_at = now() where org_id = $1`, [orgId]);
    // the password shown on the projector stops working (a password nobody knows)
    await q.query(`update sm_users set password_hash = $2 where prefs ->> 'demo_org' = $1::text and password_hash is not null`, [orgId, await hashPassword(readableCode(6, 4))]);
    await q.query(`delete from sm_sessions where user_id in (select id from sm_users where prefs ->> 'demo_org' = $1::text)`, [orgId]);
  }
  return true;
}

/** The demo account behind an email, with the organisation it belongs to (null for any other account). */
export async function demoOrgOf(q: Queryable, userId: string): Promise<string | null> {
  const r = await q.one<{ org: string | null }>(`select prefs ->> 'demo_org' as org from sm_users where id = $1`, [userId]);
  return r?.org ?? null;
}
