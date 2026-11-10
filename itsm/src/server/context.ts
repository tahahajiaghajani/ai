// Server configuration and the per-request context handed to services.
import type { Db, Tx } from "./db";
import type { Area, Level, Role } from "@shared/permissions";
import { can as canDo, AREAS, LEVEL_ORDER } from "@shared/permissions";
import type { ModuleKey } from "@shared/constants";
import { forbidden } from "./http/errors";
import { assertWritable } from "./modules/platform/org-admin";
import { recordSupportWrite } from "./modules/platform/support";
import { bumpLocal } from "./live";

export type Mode = "cloud" | "desktop";

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (m, d) => console.log(`[itsm] ${m}`, d ?? ""),
  warn: (m, d) => console.warn(`[itsm] ${m}`, d ?? ""),
  error: (m, d) => console.error(`[itsm] ${m}`, d ?? ""),
};

/** Capabilities that only exist inside the Windows app (backups, LAN, cloud link…). */
export interface DesktopBridge {
  info(): Promise<Record<string, unknown>>;
  backupNow(): Promise<{ file: string }>;
  listBackups(): Promise<{ file: string; size: number; at: string }[]>;
  restoreBackup(file: string): Promise<void>;
  getSettings(): Promise<Record<string, unknown>>;
  setSettings(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  syncStatus(): Promise<Record<string, unknown>>;
  syncNow(): Promise<Record<string, unknown>>;
  link(input: { url: string; email: string; password: string; orgId?: string; direction: "download" | "upload" }): Promise<Record<string, unknown>>;
  unlink(): Promise<void>;
  cloudOrgs(input: { url: string; email: string; password: string }): Promise<unknown>;
  /**
   * Sign-in fallback while linked: check the password against the cloud and cache it. `user_id`
   * is the cloud account's id (the local account must be that one); `unreachable` when the cloud
   * could not be asked.
   */
  cloudLogin?(email: string, password: string): Promise<{ ok: boolean; user_id?: string; unreachable?: boolean; limited?: boolean }>;
  notifyLocalWrite(): void;
  /** Fetch an attachment's content from the linked cloud (contents travel lazily); null when unavailable. */
  fetchBlob?(orgId: string, attachmentId: string): Promise<Uint8Array | null>;
}

export interface ServerConfig {
  mode: Mode;
  db: Db;
  /** signs sessions and encrypts stored secrets */
  secret: string;
  /**
   * Where `secret` came from: APP_SECRET ("env"), derived from the database URL ("derived": stored
   * keys become unreadable when that URL changes) or the Windows installation's own ("installation").
   * Shown on «سلامت سامانه»; when unset it is inferred from the mode and process.env.APP_SECRET.
   */
  secretSource?: "env" | "derived" | "installation";
  allowSignup: boolean;
  /** platform administrators (the app owner) by email */
  platformAdmins: string[];
  /** id of this installation (desktop) or "cloud"; stored in `origin` of written rows */
  origin: string;
  publicUrl?: string;
  desktop?: DesktopBridge;
  log: Logger;
  /** fetch used for every outbound call (AI providers, integrations; lets tests stub it) */
  fetch: typeof fetch;
  /**
   * Runs background work after the response and keeps the function alive for it (cloud: Next.js `after`, which
   * uses Vercel's waitUntil). The API ticks the job queue through it after write requests that queued jobs; absent
   * on the desktop (its own timer ticks every 10 s) and in tests (they tick explicitly).
   */
  waitUntil?: (work: () => Promise<unknown>) => void;
  /**
   * Cookies and proxies of the installation (src/server/auth/session.ts; environment fallbacks ITSM_COOKIE_SECURE,
   * ITSM_COOKIE_SAMESITE, ITSM_TRUSTED_PROXIES): `cookieSecure` "auto" sets Secure on HTTPS requests (X-Forwarded-Proto
   * counts only from a trusted proxy), `trustedProxies` are the addresses whose X-Forwarded-For / -Proto are believed
   * (loopback always is). `directoryLan`: domain controllers on the installation's own network may be reached
   * (an on-premises server; env ITSM_DIRECTORY_LAN=1) — the web version reaches public LDAP hosts only.
   */
  auth?: { cookieSecure?: "auto" | "always" | "never"; cookieSameSite?: "Lax" | "Strict"; trustedProxies?: string[]; directoryLan?: boolean };
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  mobile: string | null;
  is_platform_admin: boolean;
  disabled: boolean;
  prefs: Record<string, unknown>;
}

export interface AuthSession {
  id: string;
  user_id: string;
  kind: "web" | "device" | "api";
  expires_at: string;
  /** how it was opened: password, ldap (domain account), sso (Windows Kerberos), proxy (IIS), device… (src/server/auth) */
  auth_method?: string | null;
  /** a directory sign-in reaches only this organisation */
  org_id?: string | null;
  source_id?: string | null;
  /** when the person last proved who they are (sensitive administration asks again after the policy's minutes) */
  reauth_at?: string | null;
  created_at?: string | null;
}

export interface OrgSettings {
  /** IANA time zone of the organisation (dates of "today", reports, the assistant's calendar) */
  timezone?: string;
  print?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface OrgRow {
  id: string;
  name: string;
  legal_name: string | null;
  modules: ModuleKey[];
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  address: string | null;
  logo: string | null;
  settings: OrgSettings;
  [k: string]: unknown;
}

export interface MemberRow {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  overrides: Partial<Record<Area, Level>>;
  is_active: boolean;
}

/** «حالت پشتیبانی»: the platform admin's time-limited access to an organisation he is not a member of. */
export type SupportLevel = "view" | "edit";
export interface SupportSession {
  id: string;
  level: SupportLevel;
  reason: string;
  started_at: string;
  expires_at: string;
}

/** Platform status of an organisation (sm_org_admin): read_only refuses writes, suspended closes it to its members. */
export type OrgStatus = "active" | "read_only" | "suspended";
export interface OrgPlatformStatus {
  status: OrgStatus;
  reason: string | null;
}

export interface WriteOptions {
  /**
   * Bookkeeping that is not the organisation's data (conversation history, caches, usage counters): allowed
   * while the organisation is read-only and inside a view-only support session, and not listed as a
   * support change in the audit log.
   */
  internal?: boolean;
}

export interface Ctx {
  cfg: ServerConfig;
  db: Db;
  user: AuthUser;
  org: OrgRow;
  member: MemberRow;
  /**
   * who acts: a member ("user"), the platform admin in a support session ("support") or the platform itself
   * ("system": jobs, flows and rules acting on their own, see engine `systemCtx`)
   */
  actor?: "user" | "support" | "system";
  /** the active support session when `actor` is "support" */
  support?: SupportSession | null;
  /** the organisation's platform status (loaded for /o/:org requests) */
  status?: OrgPlatformStatus | null;
  /** the request's session (loaded for /o/:org requests): re-authentication of sensitive administration (src/server/auth/policy.ts) */
  session?: AuthSession | null;
  can(area: Area, level: Level): boolean;
  need(area: Area, level: Level): void;
  /**
   * Run `fn` in a write transaction holding the organisation's write lock. Refused while the
   * organisation is read-only or suspended (unless `internal`); inside a support session every change
   * is tagged and listed in the organisation's audit log.
   */
  write<T>(fn: (tx: Tx) => Promise<T>, opts?: WriteOptions): Promise<T>;
  hasModule(m: ModuleKey): boolean;
}

/** Serialises writes of one organisation (and keeps revision numbers in commit order). */
export async function lockOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.query(
    `insert into sm_org_sync (org_id, rev) values ($1, 0)
     on conflict (org_id) do update set rev = sm_org_sync.rev`,
    [orgId],
  );
}

export const NOT_MEMBER_MESSAGE = "شما عضو این سازمان نیستید؛ برای کار در آن، از «مدیریت سامانه» حالت پشتیبانی را آغاز کنید";
export const SUPPORT_VIEW_ONLY_MESSAGE = "حالت پشتیبانی شما فقط برای مشاهده است؛ برای اصلاح، حالت پشتیبانی «مشاهده و اصلاح» را آغاز کنید";

/**
 * The level a support session grants in an area. «مشاهده» sees every area (the assistant stays off:
 * it would spend the organisation's AI budget); «مشاهده و اصلاح» works like the organisation's manager,
 * except for what would outlive the session: members are never changed, API keys and webhooks are
 * only seen (a key or a webhook secret he chose would keep working after the session ends) and the
 * assistant may draft but AI connections and keys stay with the members (a connection to his own
 * gateway would receive the members' later prompts). Owner-only actions check the member's role,
 * which a support session never has.
 */
export function supportLevel(level: SupportLevel, area: Area): Level {
  if (area === "users") return "view";
  if (level === "view") return area === "ai" ? "none" : "view";
  if (area === "integrations") return "view";
  if (area === "ai") return "edit";
  return "full";
}

export function supportPermissions(level: SupportLevel): Record<Area, Level> {
  const out = {} as Record<Area, Level>;
  for (const a of Object.keys(AREAS) as Area[]) out[a] = supportLevel(level, a);
  return out;
}

/** A placeholder membership (no id): a platform admin who is not a member of the organisation. */
export const isOutsider = (member: MemberRow) => !member.id;

export interface CtxOptions {
  support?: SupportSession | null;
  status?: OrgPlatformStatus | null;
  /** the request being served: describes a support session's changes in the audit log */
  request?: { method: string; path: string } | null;
}

export function makeCtx(cfg: ServerConfig, user: AuthUser, org: OrgRow, member: MemberRow, opts: CtxOptions = {}): Ctx {
  // A member acts through the membership, platform admins included. A platform admin who is not a
  // member gets in only through an active support session, and then only at its level; without one
  // nothing is allowed (there is no silent superuser).
  const outsider = isOutsider(member);
  const support = outsider ? (opts.support ?? null) : null;
  const rank = (l: Level) => LEVEL_ORDER.indexOf(l);
  const ctx: Ctx = {
    cfg,
    db: cfg.db,
    user,
    org,
    member,
    actor: support ? "support" : "user",
    support,
    status: opts.status ?? null,
    can: (area, level) => {
      if (outsider) return !!support && rank(supportLevel(support.level, area)) >= rank(level);
      return canDo(member.role, area, level, member.overrides);
    },
    need: (area, level) => {
      if (ctx.can(area, level)) return;
      if (outsider && !support) throw forbidden(NOT_MEMBER_MESSAGE);
      throw forbidden();
    },
    write: async (fn, wopts) => {
      if (outsider && !support) throw forbidden(NOT_MEMBER_MESSAGE);
      if (support?.level === "view" && !wopts?.internal) throw forbidden(SUPPORT_VIEW_ONLY_MESSAGE);
      const result = await cfg.db.tx(async (tx) => {
        await lockOrg(tx, org.id);
        if (!wopts?.internal) await assertWritable(tx, org.id);
        if (support) {
          const live = await tx.one(
            `select set_config('itsm.actor_kind', 'support', true), set_config('itsm.support_session', id::text, true)
             from sm_support_sessions where id = $1 and ended_at is null and expires_at > now()`,
            [support.id],
          );
          if (!live) throw forbidden("حالت پشتیبانی شما پایان یافته است");
        }
        const out = await fn(tx);
        if (support && !wopts?.internal) await recordSupportWrite(tx, cfg, org.id, user.id, support.id, opts.request ?? null);
        return out;
      });
      cfg.desktop?.notifyLocalWrite();
      if (cfg.mode !== "cloud") bumpLocal(org.id);
      return result;
    },
    hasModule: (m) => Array.isArray(org.modules) && org.modules.includes(m),
  };
  return ctx;
}
