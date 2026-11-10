// Shared helpers of the integration hub: the call log (sm_int_log: who, what, status, latency — never secrets or record
// bodies), the integration users' member contexts (never the system's), and the hub's access checks.
import type { Ctx, ServerConfig } from "../../context";
import type { Queryable } from "../../db";
import { uuidv7 } from "@shared/id";
import { forbidden, notFound } from "../../http/errors";
import { systemCtx } from "../../engine";
import { memberCtx } from "../../access";
import { subjectOf } from "../../access/subject";
import { liveRow, liveRows, sysOf, type Row } from "../incident/common";

export { liveRow, liveRows, sysOf, type Row };

export type LogKind = "api" | "webhook" | "inbound" | "directory" | "scim" | "issue" | "export";

export interface LogEntry {
  org_id: string;
  kind: LogKind;
  ref_id?: string | null;
  actor?: string | null;
  method?: string | null;
  target?: string | null;
  status?: number | null;
  ok: boolean;
  latency_ms?: number | null;
  summary?: string | null;
  error?: string | null;
}

/** Strip query strings and credentials from a URL before it is logged. */
export function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return String(url).split("?")[0].slice(0, 300);
  }
}

export async function intLog(q: Queryable, e: LogEntry): Promise<void> {
  await q
    .query(
      `insert into sm_int_log (id, org_id, kind, ref_id, actor, method, target, status, ok, latency_ms, summary, error) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [uuidv7(), e.org_id, e.kind, e.ref_id ?? null, e.actor ?? null, e.method ?? null, e.target ?? null, e.status ?? null, e.ok, e.latency_ms ?? null, e.summary?.slice(0, 500) ?? null, e.error?.slice(0, 1000) ?? null],
    )
    .catch(() => undefined);
}

/** The hub's pages: the integrations area of the membership role. */
export function needIntegrations(ctx: Ctx, level: "view" | "edit" | "full"): void {
  ctx.need("integrations", level);
}

/**
 * The member context of an integration user: its own ITSM roles and nothing else. Refused when the user is switched
 * off, has no service account, or holds no explicit role (a member without roles would fall back to the membership
 * role's broad access — an integration user never does).
 */
export async function principalCtx(cfg: ServerConfig, orgId: string, integrationUserId: string | null | undefined): Promise<{ ctx: Ctx; user: Row }> {
  if (!integrationUserId) throw forbidden("کاربر یکپارچه‌سازی تعیین نشده است");
  const sys = await systemCtx(cfg, orgId);
  const user = await liveRow(cfg.db, sys, "integration_user", integrationUserId);
  if (!user) throw notFound("کاربر یکپارچه‌سازی پیدا نشد");
  if (user.active === false) throw forbidden(`کاربر یکپارچه‌سازی «${user.name}» غیرفعال است`);
  if (!user.user_id) throw forbidden(`کاربر یکپارچه‌سازی «${user.name}» حساب ندارد`);
  const ctx = await memberCtx(cfg, orgId, String(user.user_id)).catch(() => null);
  if (!ctx) throw forbidden(`حساب کاربر یکپارچه‌سازی «${user.name}» فعال نیست`);
  const s = subjectOf(ctx);
  if (s.eff.legacy || !s.eff.roles.length) throw forbidden(`برای کاربر یکپارچه‌سازی «${user.name}» هنوز نقشی تعیین نشده است؛ نقش‌های آن را در «کاربران یکپارچه‌سازی» انتخاب کنید`);
  return { ctx, user };
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
