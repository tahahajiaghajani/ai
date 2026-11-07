// Per-request helpers of the record engine: the caller's condition environment (who "me", "my groups", "my unit"
// are; the organisation's time zone), the acting user id stored in created_by/updated_by/history, and the system
// context jobs, flows and rules act through.
import type { CondEnv } from "@shared/model/conditions";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import type { AuthUser, Ctx, MemberRow, OrgRow, ServerConfig } from "../context";
import { lockOrg } from "../context";
import type { Tx } from "../db";
import { access } from "../access/provider";
import { assertWritable } from "../modules/platform/org-admin";
import { notFound } from "../http/errors";
import { bumpLocal } from "../live";

const envs = new WeakMap<Ctx, Promise<CondEnv>>();

/**
 * The caller's identity for conditions (`is_me`, `in_my_groups`, relative dates in the organisation's time zone…),
 * asked of the access provider once per request and cached on the context.
 */
export function condEnv(ctx: Ctx): Promise<CondEnv> {
  let hit = envs.get(ctx);
  if (!hit) {
    hit = access()
      .env(ctx)
      .then((env) => ({ tz: orgTz(ctx), ...env, userId: actorId(ctx) === null ? null : env.userId ?? ctx.user.id }));
    envs.set(ctx, hit);
    // a failure is not cached: the next call asks again
    hit.catch(() => envs.delete(ctx));
  }
  return hit;
}

/** The organisation's IANA time zone (settings.timezone, default Asia/Tehran). */
export function orgTz(ctx: Ctx): string {
  const tz = ctx.org.settings?.timezone;
  return typeof tz === "string" && tz ? tz : DEFAULT_TIMEZONE;
}

export const isSystemCtx = (ctx: Ctx) => ctx.actor === "system";

const NIL = "00000000-0000-0000-0000-000000000000";

/** The user recorded as the author of a change (null for the system acting on its own). */
export function actorId(ctx: Ctx): string | null {
  return ctx.user.id === NIL ? null : ctx.user.id;
}

/** The pseudo account of the system context (never stored: writes record a null actor). */
export const SYSTEM_USER: AuthUser = {
  id: NIL,
  email: "system@localhost",
  full_name: "سامانه",
  mobile: null,
  is_platform_admin: false,
  disabled: false,
  prefs: {},
};

/**
 * A context in which the platform itself acts in an organisation — job handlers, flows, rules, SLA timers. The
 * access provider allows it everything within the organisation (`ctx.actor === "system"`); its writes hold the
 * organisation's write lock like any other and are refused while the platform made the organisation read-only.
 * `onBehalfOf` records a member as the actor instead (a flow that runs as the user who triggered it).
 */
export async function systemCtx(cfg: Pick<ServerConfig, "db"> & Partial<ServerConfig>, orgId: string, opts: { onBehalfOf?: string | null } = {}): Promise<Ctx> {
  const org = await cfg.db.one<OrgRow>(`select * from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  let user: AuthUser = SYSTEM_USER;
  if (opts.onBehalfOf) {
    const u = await cfg.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [opts.onBehalfOf]);
    if (u) user = u;
  }
  const member: MemberRow = { id: NIL, org_id: orgId, user_id: user.id, role: "owner", overrides: {}, is_active: true };
  const full = cfg as ServerConfig;
  const ctx: Ctx = {
    cfg: full,
    db: cfg.db,
    user,
    org,
    member,
    actor: "system",
    support: null,
    status: null,
    can: () => true,
    need: () => undefined,
    write: async <T,>(fn: (tx: Tx) => Promise<T>, wopts?: { internal?: boolean }) => {
      const out = await cfg.db.tx(async (tx) => {
        await lockOrg(tx, orgId);
        if (!wopts?.internal) await assertWritable(tx, orgId);
        return fn(tx);
      });
      if (full.mode !== "cloud") bumpLocal(orgId);
      full.desktop?.notifyLocalWrite();
      return out;
    },
    hasModule: (m) => Array.isArray(org.modules) && org.modules.includes(m),
  };
  return ctx;
}
