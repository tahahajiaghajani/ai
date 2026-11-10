// The organisation's sign-in and session policy (settings → «امنیت ورود و نشست‌ها»), kept in sm_orgs.settings.auth:
// idle timeout and absolute lifetime of sessions, one active session per person, re-authentication before sensitive
// administration, cookies that end with the browser, who may still sign in with a local password once the
// organisation signs in with its directory (break-glass accounts), and the local lockout that keeps password spraying
// away from the domain controllers. A person in several organisations gets the strictest of their policies.
// Imported by the UI: keep it free of server imports.

export interface SessionPolicy {
  /** minutes without activity after which a session ends (0: never) */
  idle_minutes: number;
  /** hours after sign-in after which a session ends whatever happens */
  absolute_hours: number;
  /** a new sign-in ends the person's other browser sessions */
  single_session: boolean;
  /** minutes a sign-in (or a re-authentication) keeps sensitive administration open (0: never asks again) */
  reauth_minutes: number;
  /** the session cookie ends when the browser closes */
  browser_session: boolean;
}

export interface LockoutPolicy {
  /** failed sign-ins of one login name before the local lockout (keep it below the domain's own threshold) */
  threshold: number;
  /** the window failures are counted in (minutes) */
  window_minutes: number;
  /** how long a locked login name is refused without asking the domain controllers (minutes) */
  lock_minutes: number;
  /** failed sign-ins from one address (any login names) before the address is held back — password spraying */
  ip_threshold: number;
}

export interface AuthPolicy {
  session: SessionPolicy;
  /** "all": every member may sign in with an e-mail and password; "breakglass": only the accounts listed */
  local_login: "all" | "breakglass";
  /** user ids of the break-glass accounts (administrators who sign in locally when the directory is down) */
  breakglass: string[];
  lockout: LockoutPolicy;
}

export const DEFAULT_POLICY: AuthPolicy = {
  session: { idle_minutes: 0, absolute_hours: 720, single_session: false, reauth_minutes: 15, browser_session: false },
  local_login: "all",
  breakglass: [],
  lockout: { threshold: 5, window_minutes: 15, lock_minutes: 15, ip_threshold: 30 },
};

/** What a bank is advised to start from (the settings page's «پیشنهاد بانک»). */
export const BANK_POLICY: AuthPolicy = {
  session: { idle_minutes: 15, absolute_hours: 10, single_session: true, reauth_minutes: 10, browser_session: true },
  local_login: "breakglass",
  breakglass: [],
  lockout: { threshold: 5, window_minutes: 15, lock_minutes: 30, ip_threshold: 20 },
};

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** A policy from stored (or typed) settings: unknown keys dropped, numbers bounded, defaults filled in. */
export function normalizePolicy(raw: unknown): AuthPolicy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const s = (r.session && typeof r.session === "object" ? r.session : {}) as Record<string, unknown>;
  const l = (r.lockout && typeof r.lockout === "object" ? r.lockout : {}) as Record<string, unknown>;
  const d = DEFAULT_POLICY;
  return {
    session: {
      idle_minutes: int(s.idle_minutes, 0, 24 * 60, d.session.idle_minutes),
      absolute_hours: int(s.absolute_hours, 1, 24 * 90, d.session.absolute_hours),
      single_session: s.single_session === true,
      reauth_minutes: int(s.reauth_minutes, 0, 24 * 60, d.session.reauth_minutes),
      browser_session: s.browser_session === true,
    },
    local_login: r.local_login === "breakglass" ? "breakglass" : "all",
    breakglass: Array.isArray(r.breakglass) ? [...new Set((r.breakglass as unknown[]).filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 50) : [],
    lockout: {
      threshold: int(l.threshold, 3, 50, d.lockout.threshold),
      window_minutes: int(l.window_minutes, 1, 24 * 60, d.lockout.window_minutes),
      lock_minutes: int(l.lock_minutes, 1, 24 * 60, d.lockout.lock_minutes),
      ip_threshold: int(l.ip_threshold, 5, 1000, d.lockout.ip_threshold),
    },
  };
}

const minPositive = (values: number[]) => {
  const pos = values.filter((v) => v > 0);
  return pos.length ? Math.min(...pos) : 0;
};

/** The strictest session rules of several organisations (a person who belongs to each of them). */
export function strictestSession(policies: SessionPolicy[]): SessionPolicy {
  if (!policies.length) return { ...DEFAULT_POLICY.session };
  return {
    idle_minutes: minPositive(policies.map((p) => p.idle_minutes)),
    absolute_hours: Math.min(...policies.map((p) => p.absolute_hours)),
    single_session: policies.some((p) => p.single_session),
    reauth_minutes: minPositive(policies.map((p) => p.reauth_minutes)),
    browser_session: policies.some((p) => p.browser_session),
  };
}

/** Problems of a policy an administrator is about to save (Persian), empty when it is sound. */
export function policyProblems(p: AuthPolicy, ctx: { directoryLogin: boolean; selfId?: string | null }): string[] {
  const out: string[] = [];
  if (p.local_login === "breakglass") {
    if (!ctx.directoryLogin) out.push("پیش از بستن ورود محلی، «ورود با حساب سازمانی» را در یک منبع فهرست کاربران روشن و تأیید کنید");
    if (!p.breakglass.length) out.push("دست‌کم یک حساب اضطراری (ورود محلی) نگه دارید تا اگر سرور دامنه در دسترس نبود، مدیر بتواند وارد شود");
  }
  if (p.session.idle_minutes > 0 && p.session.idle_minutes > p.session.absolute_hours * 60) out.push("زمان بیکاری نباید از عمر کامل نشست بیشتر باشد");
  return out;
}
