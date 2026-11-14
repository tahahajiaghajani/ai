// Hono environment, middlewares and small request helpers shared by all routes.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { ZodType } from "zod";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import type { AuthSession, AuthUser, Ctx, MemberRow, OrgPlatformStatus, OrgRow, ServerConfig } from "../context";
import { makeCtx } from "../context";
import { AppError, bad, dbErrorMessage, forbidden, notFound, tooMany, unauthorized, zodToAppError } from "./errors";
import { BACKGROUND_HEADER, COOKIE, resolveToken, tokenFromRequest, clientIp } from "../auth/session";
import { guardOrgSession } from "../auth/policy";
import { inDemoScope } from "../db/scope";
import { demoSignInRefusal } from "../modules/demo/signin";
import { AiUnavailableError, aiHttpError } from "../modules/ai/errors";

export type Vars = {
  cfg: ServerConfig;
  user: AuthUser;
  session: AuthSession;
  ctx: Ctx;
  /** the organisation's platform status, read with the organisation by loadOrg (modules/platform/access.ts uses it) */
  orgStatus: OrgPlatformStatus;
};
export type Env = { Variables: Vars };
export type C = Context<Env>;

export const router = () => new Hono<Env>();

/** The live pulse (GET /api/o/:org/pulse) is polled by a screen, never asked for by the person. */
const PULSE_PATH = /\/o\/[0-9a-f-]{36}\/pulse\/?$/i;

/**
 * Is this a request the person did not make? The client marks its timers with BACKGROUND_HEADER; the scoped live
 * pulse counts as background whatever the client sends, so it never keeps a session past its idle timeout (S2).
 */
export function isBackgroundRequest(c: Pick<C, "req">): boolean {
  return c.req.header(BACKGROUND_HEADER) === "1" || (c.req.method === "GET" && PULSE_PATH.test(c.req.path));
}

/**
 * One request in `cfg.foreground`, the requests a person waits for (src/server-edition/foreground.ts,
 * src/desktop/server.ts). A browser's — its session cookie and no Authorization header, the screen's own polling
 * aside — counts from here, before its session is looked up: under load that lookup is where it waits, and the job
 * runner must already know. Once the session is known, only a signed-in browser session's (kind "web") stays counted
 * and keeps the gate busy for its linger after the answer; a made-up or ended cookie ends at once (its 401), with no
 * linger. A Windows app's sync and any other token client (Authorization), a monitoring probe and anyone without a
 * session cookie never count: machine traffic must not hold the job runner back.
 */
function foregroundOf(c: C) {
  const fg = c.get("cfg").foreground;
  let open = !!fg && !c.req.header("authorization") && !isBackgroundRequest(c) && !!getCookie(c, COOKIE);
  let person = false;
  if (open) fg!.started();
  return {
    /** The session is known (null: none): a browser session's request stays counted, any other ends now. */
    known(session: AuthSession | null) {
      person = session?.kind === "web";
      if (open && !person) {
        open = false;
        fg!.ended({ linger: false });
      }
    },
    /** The answer is out (or the request failed). */
    done() {
      if (!open) return;
      open = false;
      fg!.ended({ linger: person });
    },
  };
}

/** Loads the signed-in user (cookie or bearer token); 401 when missing. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const foreground = foregroundOf(c);
  try {
    const resolved = await resolveToken(cfg.db, tokenFromRequest(c), { background: isBackgroundRequest(c) });
    foreground.known(resolved?.session ?? null);
    if (!resolved) throw unauthorized();
    c.set("user", resolved.user);
    c.set("session", resolved.session);
    await next();
  } finally {
    foreground.done();
  }
};

/** Same as requireUser but continues anonymously. */
export const optionalUser: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const foreground = foregroundOf(c);
  try {
    const resolved = await resolveToken(cfg.db, tokenFromRequest(c), { background: isBackgroundRequest(c) });
    foreground.known(resolved?.session ?? null);
    if (resolved) {
      c.set("user", resolved.user);
      c.set("session", resolved.session);
    }
    await next();
  } finally {
    foreground.done();
  }
};

/** For /o/:org/* — loads the organisation and the caller's membership. */
export const loadOrg: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const user = c.get("user");
  const orgId = c.req.param("org") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound("سازمان پیدا نشد");
  // the organisation and the caller's membership in one round trip (every organisation request starts here)
  // the organisation, the caller's membership and the platform status in one round trip (every organisation request
  // starts here)
  const row = await cfg.db.one<OrgRow & { m__id: string | null; m__role: MemberRow["role"]; m__overrides: MemberRow["overrides"]; m__is_active: boolean; a__status: OrgPlatformStatus["status"] | null; a__reason: string | null }>(
    `select o.*, m.id as m__id, m.role as m__role, m.overrides as m__overrides, m.is_active as m__is_active,
            a.status as a__status, a.status_reason as a__reason
       from sm_orgs o
       left join sm_org_members m on m.org_id = o.id and m.user_id = $2 and m.deleted_at is null
       left join sm_org_admin a on a.org_id = o.id
      where o.id = $1 and o.deleted_at is null`,
    [orgId, user.id],
  );
  if (!row) throw notFound("سازمان پیدا نشد");
  const { m__id, m__role, m__overrides, m__is_active, a__status, a__reason, ...org } = row;
  c.set("orgStatus", { status: a__status ?? "active", reason: a__reason ?? null });
  let member: MemberRow | null = m__id ? { id: m__id, org_id: orgId, user_id: user.id, role: m__role, overrides: m__overrides, is_active: m__is_active } : null;
  if (!member || !member.is_active) {
    if (!user.is_platform_admin) throw forbidden("شما عضو این سازمان نیستید");
    member = { id: "", org_id: orgId, user_id: user.id, role: "viewer", overrides: {}, is_active: true };
  }
  // a directory sign-in reaches only its organisation; a closed local sign-in only for break-glass accounts
  guardOrgSession(org, c.get("session"), user, member.id ? member : null, cfg.mode);
  c.set("ctx", makeCtx(cfg, user, org, member, { session: c.get("session") ?? null }));
  // the people of the organisation's demo pack (docs/DEMO_FA.md): what they do is demo data, removed with the pack
  if (member.id && user.prefs?.demo_org === org.id) {
    // only while the organisation's administrators allow demo sign-in (docs/DEMO_FA.md)
    const refused = await demoSignInRefusal(cfg.db, user, org.id);
    if (refused) throw forbidden(refused);
    await inDemoScope(org.id, () => next());
  }
  else await next();
};

/** Mutations must be JSON from the same origin (cheap CSRF defence on top of SameSite cookies). */
export const sameOrigin: MiddlewareHandler<Env> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !c.req.header("authorization")) {
    const origin = c.req.header("origin");
    if (origin) {
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) throw forbidden("درخواست از مبدأ نامعتبر");
    }
  }
  await next();
};

export async function body<T>(c: C, schema: ZodType<T>): Promise<T> {
  let raw: unknown = {};
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      raw = await c.req.json();
    } catch (e) {
      // a body over the size limit (the server edition counts chunked bodies while they are read) stays a 413
      if (e instanceof AppError) throw e;
      throw bad("بدنه‌ی درخواست JSON معتبر نیست");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}

export function query<T>(c: C, schema: ZodType<T>): T {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}

const AI_UNAVAILABLE = "هوش مصنوعی اکنون در دسترس نیست؛ کمی بعد دوباره امتحان کنید";

export function errorResponse(err: unknown, c: Context) {
  let e: AppError;
  // AI cannot answer now (no model, switched off, budget, provider down…): the Persian answer of its kind, never a 500
  if (err instanceof AiUnavailableError) e = aiHttpError(err.kind, err.message);
  else if (err instanceof AppError && err.code.startsWith("ai_") && err.status >= 500) e = new AppError(503, err.code, err.message || AI_UNAVAILABLE, err.details ?? { kind: err.code.slice(3) });
  else if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) e = zodToAppError(err);
  else {
    const mapped = dbErrorMessage(err);
    if (mapped) e = mapped;
    else {
      // an id the person can quote and the operator finds in the log, with the stack
      const id = randomUUID().slice(0, 8);
      const cfg = (c as C).get?.("cfg");
      cfg?.log.error(`unhandled error [${id}]`, { id, method: c.req.method, path: c.req.path, err: String((err as Error)?.stack ?? err) });
      e = new AppError(500, "internal", `خطای داخلی سرور؛ دوباره امتحان کنید (کد پیگیری: ${id})`, { error_id: id });
    }
  }
  return c.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, e.status as 400);
}

// --- tiny in-memory rate limiter (per server instance) ---
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  b.n += 1;
  if (b.n > limit) throw tooMany();
}

export function limitByIp(c: C, name: string, limit: number, windowMs: number) {
  rateLimit(`${name}:${clientIp(c)}`, limit, windowMs);
}

/** Forget every window of the limiter (tests that build several organisations in one process). */
export function resetRateBuckets(): void {
  buckets.clear();
}
