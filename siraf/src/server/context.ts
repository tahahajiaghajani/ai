// Server configuration and the per-request context handed to services.
import type { Db, Tx } from "./db";
import type { Area, Level, Role } from "@shared/permissions";
import { can as canDo } from "@shared/permissions";
import type { ModuleKey } from "@shared/constants";
import { forbidden } from "./http/errors";

export type Mode = "cloud" | "desktop";

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (m, d) => console.log(`[taraz] ${m}`, d ?? ""),
  warn: (m, d) => console.warn(`[taraz] ${m}`, d ?? ""),
  error: (m, d) => console.error(`[taraz] ${m}`, d ?? ""),
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
  /** sign-in fallback while linked: check the password against the cloud and cache it */
  cloudLogin?(email: string, password: string): Promise<{ ok: boolean; user?: Record<string, unknown> }>;
  notifyLocalWrite(): void;
}

export interface ServerConfig {
  mode: Mode;
  db: Db;
  /** signs sessions and encrypts stored secrets */
  secret: string;
  allowSignup: boolean;
  /** platform administrators (the app owner) by email */
  platformAdmins: string[];
  /** id of this installation (desktop) or "cloud"; stored in `origin` of written rows */
  origin: string;
  publicUrl?: string;
  desktop?: DesktopBridge;
  log: Logger;
  /** fetch used for live prices and blockchain lookups (lets tests stub it) */
  fetch: typeof fetch;
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
}

export interface OrgSettings {
  vat_pct?: string;
  money_unit?: string;
  timezone?: string;
  costing?: "average" | "fifo";
  allow_negative_stock?: boolean;
  gold?: {
    profit_pct?: string;
    tax_pct?: string;
    round_step?: string;
    old_deduction_pct?: string;
    price_source?: string;
  };
  fx?: {
    providers?: string[];
    margin_pct?: string;
    refresh_seconds?: number;
  };
  print?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface OrgRow {
  id: string;
  name: string;
  legal_name: string | null;
  business_kind: string;
  modules: ModuleKey[];
  base_currency: string;
  money_decimals: number;
  economic_code: string | null;
  national_id: string | null;
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

export interface Ctx {
  cfg: ServerConfig;
  db: Db;
  user: AuthUser;
  org: OrgRow;
  member: MemberRow;
  can(area: Area, level: Level): boolean;
  need(area: Area, level: Level): void;
  /** run `fn` in a write transaction holding the organisation's write lock */
  write<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  hasModule(m: ModuleKey): boolean;
}

/** Serialises writes of one organisation (and keeps revision numbers in commit order). */
export async function lockOrg(tx: Tx, orgId: string): Promise<void> {
  await tx.query(
    `insert into tz_org_sync (org_id, rev) values ($1, 0)
     on conflict (org_id) do update set rev = tz_org_sync.rev`,
    [orgId],
  );
}

export function makeCtx(cfg: ServerConfig, user: AuthUser, org: OrgRow, member: MemberRow): Ctx {
  const ctx: Ctx = {
    cfg,
    db: cfg.db,
    user,
    org,
    member,
    can: (area, level) => user.is_platform_admin || canDo(member.role, area, level, member.overrides),
    need: (area, level) => {
      if (!ctx.can(area, level)) throw forbidden();
    },
    write: async (fn) => {
      const result = await cfg.db.tx(async (tx) => {
        await lockOrg(tx, org.id);
        return fn(tx);
      });
      cfg.desktop?.notifyLocalWrite();
      return result;
    },
    hasModule: (m) => Array.isArray(org.modules) && org.modules.includes(m),
  };
  return ctx;
}
