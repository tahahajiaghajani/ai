// Hono environment, middlewares and small request helpers shared by all routes.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ZodType } from "zod";
import { ZodError } from "zod";
import type { AuthSession, AuthUser, Ctx, MemberRow, OrgRow, ServerConfig } from "../context";
import { makeCtx } from "../context";
import { AppError, bad, dbErrorMessage, forbidden, notFound, tooMany, unauthorized, zodToAppError } from "./errors";
import { resolveToken, tokenFromRequest, clientIp } from "../auth/session";
import { guardOrgSession } from "../auth/policy";
import { AiUnavailableError, aiHttpError } from "../modules/ai/errors";

export type Vars = {
  cfg: ServerConfig;
  user: AuthUser;
  session: AuthSession;
  ctx: Ctx;
};
export type Env = { Variables: Vars };
export type C = Context<Env>;

export const router = () => new Hono<Env>();

/** Loads the signed-in user (cookie or bearer token); 401 when missing. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const resolved = await resolveToken(cfg.db, tokenFromRequest(c));
  if (!resolved) throw unauthorized();
  c.set("user", resolved.user);
  c.set("session", resolved.session);
  await next();
};

/** Same as requireUser but continues anonymously. */
export const optionalUser: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const resolved = await resolveToken(cfg.db, tokenFromRequest(c));
  if (resolved) {
    c.set("user", resolved.user);
    c.set("session", resolved.session);
  }
  await next();
};

/** For /o/:org/* — loads the organisation and the caller's membership. */
export const loadOrg: MiddlewareHandler<Env> = async (c, next) => {
  const cfg = c.get("cfg");
  const user = c.get("user");
  const orgId = c.req.param("org") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw notFound("سازمان پیدا نشد");
  const org = await cfg.db.one<OrgRow>(`select * from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  let member = await cfg.db.one<MemberRow>(
    `select id, org_id, user_id, role, overrides, is_active from sm_org_members
     where org_id = $1 and user_id = $2 and deleted_at is null`,
    [orgId, user.id],
  );
  if (!member || !member.is_active) {
    if (!user.is_platform_admin) throw forbidden("شما عضو این سازمان نیستید");
    member = { id: "", org_id: orgId, user_id: user.id, role: "viewer", overrides: {}, is_active: true };
  }
  // a directory sign-in reaches only its organisation; a closed local sign-in only for break-glass accounts
  guardOrgSession(org, c.get("session"), user, member.id ? member : null, cfg.mode);
  c.set("ctx", makeCtx(cfg, user, org, member, { session: c.get("session") ?? null }));
  await next();
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
    } catch {
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
      const cfg = (c as C).get?.("cfg");
      cfg?.log.error("unhandled error", { path: c.req.path, err: String((err as Error)?.stack ?? err) });
      e = new AppError(500, "internal", "خطای داخلی سرور؛ دوباره امتحان کنید");
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
