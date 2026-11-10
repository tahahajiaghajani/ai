// Access to /o/:org/* beyond membership: the platform admin's support session and the organisation's
// platform status. Runs right after loadOrg for every organisation route (routes/org.ts mounts it
// first under /o/:org); it is idempotent, so it may also be mounted directly after loadOrg.
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../http/hono";
import { forbidden } from "../../http/errors";
import { isOutsider, makeCtx, NOT_MEMBER_MESSAGE, SUPPORT_VIEW_ONLY_MESSAGE, type SupportSession } from "../../context";
import { orgStatus, statusError } from "./org-admin";
import { activeSupportSession } from "./support";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export const orgAccess: MiddlewareHandler<Env> = async (c, next) => {
  const ctx = c.get("ctx");
  // not an organisation route, or already resolved
  if (!ctx || ctx.status) return next();
  const db = ctx.cfg.db;
  const status = await orgStatus(db, ctx.org.id);
  let support: SupportSession | null = null;
  if (isOutsider(ctx.member)) {
    if (ctx.user.is_platform_admin) support = await activeSupportSession(db, ctx.org.id, ctx.user.id);
    if (!support) throw forbidden(NOT_MEMBER_MESSAGE);
    if (support.level === "view" && !READS.has(c.req.method)) throw forbidden(SUPPORT_VIEW_ONLY_MESSAGE);
  } else if (status.status === "suspended") {
    // a suspended organisation is closed to its members; a support session still sees it
    throw statusError(status);
  }
  c.set("ctx", makeCtx(ctx.cfg, ctx.user, ctx.org, ctx.member, { support, status, request: { method: c.req.method, path: c.req.path }, session: ctx.session ?? null }));
  await next();
};
