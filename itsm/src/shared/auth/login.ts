// «ورود با حساب سازمانی» and Windows single sign-on, the parts the server and the screens share: the three forms of a
// login name (ali, CORP\ali, ali@corp.bank.ir), Active Directory's account flags (userAccountControl, accountExpires,
// pwdLastSet, msDS-UserPasswordExpiryTimeComputed, msDS-User-Account-Control-Computed) and bind sub-codes, the reasons a
// sign-in is refused with the Persian sentence people see — never one that tells whether an account exists unless the
// password was proven right — and the SPN commands of the SSO checklist.
// Imported by the UI: keep it free of server imports.

export type LoginForm = "plain" | "netbios" | "upn";

export interface ParsedLogin {
  form: LoginForm;
  /** the account part (ali) */
  name: string;
  /** the NetBIOS or DNS domain (lower case), null for a bare name */
  domain: string | null;
  /** the login as one text (corp\ali, ali@corp.bank.ir, ali) — lower case, for counters and the audit */
  key: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Read a login name in any of its forms; null when it cannot be one. */
export function parseLogin(raw: unknown): ParsedLogin | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 256 || CONTROL.test(text)) return null;
  const slash = text.indexOf("\\");
  if (slash >= 0) {
    const domain = text.slice(0, slash).trim();
    const name = text.slice(slash + 1).trim();
    if (!domain || !name || name.includes("\\") || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,62}$/u.test(domain)) return null;
    return { form: "netbios", name, domain: domain.toLowerCase(), key: `${domain}\\${name}`.toLowerCase() };
  }
  const at = text.lastIndexOf("@");
  if (at >= 0) {
    const name = text.slice(0, at).trim();
    const domain = text.slice(at + 1).trim();
    if (!name || !domain || !/^[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?(\.[\p{L}\p{N}]([\p{L}\p{N}-]*[\p{L}\p{N}])?)*$/u.test(domain)) return null;
    return { form: "upn", name, domain: domain.toLowerCase(), key: `${name}@${domain}`.toLowerCase() };
  }
  return { form: "plain", name: text, domain: null, key: text.toLowerCase() };
}

/** Is `domain` (NetBIOS or DNS) one of a source's domains? */
export function domainMatches(domain: string | null | undefined, domains: unknown): boolean {
  if (!domain) return false;
  const d = domain.trim().toLowerCase();
  return (Array.isArray(domains) ? domains : []).some((x) => typeof x === "string" && x.trim().toLowerCase() === d);
}

/** The account and realm of a Kerberos principal or a Windows name (ali@CORP.BANK.IR, CORP\ali). */
export function principalParts(principal: string): { name: string; domain: string | null } | null {
  const p = parseLogin(principal);
  if (!p) return null;
  return { name: p.name, domain: p.domain };
}

// ---------------------------------------------------------------- Active Directory account state

export const UAC = { ACCOUNTDISABLE: 0x2, LOCKOUT: 0x10, PASSWD_NOTREQD: 0x20, DONT_EXPIRE_PASSWORD: 0x10000, PASSWORD_EXPIRED: 0x800000 } as const;

const FILETIME_EPOCH_MS = 11644473600000;
const NEVER = 9223372036854775807n;

/** A Windows FILETIME (100 ns ticks since 1601) as JavaScript milliseconds; null for 0 and «never». */
export function filetimeMs(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = BigInt(s);
  if (n <= 0n || n >= NEVER) return null;
  return Number(n / 10000n) - FILETIME_EPOCH_MS;
}

export interface AccountState {
  disabled: boolean;
  /** locked out now (the domain controller's computed flag) */
  locked: boolean;
  /** accountExpires has passed */
  expired: boolean;
  passwordExpired: boolean;
  /** pwdLastSet = 0: «User must change password at next logon» */
  mustChange: boolean;
}

/** The state of an account from its attributes (names compared case-insensitively). */
export function accountState(attrs: Record<string, string[] | undefined>, now = Date.now()): AccountState {
  const get = (name: string) => {
    const k = Object.keys(attrs).find((x) => x.toLowerCase() === name.toLowerCase());
    return k ? attrs[k]?.[0] : undefined;
  };
  const num = (name: string) => {
    const v = Number(get(name) ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const uac = num("userAccountControl");
  const computed = num("msDS-User-Account-Control-Computed");
  const expires = filetimeMs(get("accountExpires"));
  const pwdExpiry = filetimeMs(get("msDS-UserPasswordExpiryTimeComputed"));
  const pwdLastSet = get("pwdLastSet");
  return {
    disabled: (uac & UAC.ACCOUNTDISABLE) !== 0,
    locked: (computed & UAC.LOCKOUT) !== 0,
    expired: expires !== null && expires <= now,
    passwordExpired: (computed & UAC.PASSWORD_EXPIRED) !== 0 || (pwdExpiry !== null && pwdExpiry <= now && (uac & UAC.DONT_EXPIRE_PASSWORD) === 0),
    mustChange: pwdLastSet !== undefined && String(pwdLastSet).trim() === "0",
  };
}

// ---------------------------------------------------------------- reasons and messages

export type LoginReason =
  | "empty_password"
  | "bad_login"
  | "unknown_domain"
  | "ambiguous_domain"
  | "no_source"
  | "unknown_account"
  | "ambiguous_account"
  | "wrong_password"
  | "locked"
  | "throttled"
  | "rate_limited"
  | "disabled"
  | "account_expired"
  | "password_expired"
  | "must_change"
  | "logon_hours"
  | "workstation"
  | "member_disabled"
  | "jit_disabled"
  | "no_email"
  | "account_conflict"
  | "reserved_email"
  | "dc_unreachable"
  | "tls"
  | "config"
  | "service_bind"
  | "not_approved"
  | "feature_off"
  | "sso_failed"
  | "sso_unavailable"
  | "proxy_untrusted"
  | "proxy_secret"
  | "ntlm_refused"
  | "local_disabled";

/** Active Directory's bind sub-code («data 52e») as a reason. */
export function reasonOfAdCode(code: string | null | undefined): LoginReason {
  switch ((code ?? "").toLowerCase()) {
    case "775":
      return "locked";
    case "533":
      return "disabled";
    case "701":
      return "account_expired";
    case "532":
      return "password_expired";
    case "773":
      return "must_change";
    case "530":
      return "logon_hours";
    case "531":
      return "workstation";
    default:
      return "wrong_password";
  }
}

/**
 * Reasons that can only be known once the password was proven right (Active Directory answers 533, 701, 532, 773, 530
 * and 531 only to the right password): saying them tells nothing to someone guessing. Every other refusal shows the
 * one sentence that does not tell whether the account exists.
 */
export const VERIFIED_REASONS: ReadonlySet<LoginReason> = new Set<LoginReason>([
  "disabled", "account_expired", "password_expired", "must_change", "logon_hours", "workstation", "member_disabled", "jit_disabled", "no_email", "account_conflict", "reserved_email",
]);

export const GENERIC_LOGIN_MESSAGE = "نام کاربری یا گذرواژه درست نیست. اگر چند بار پیاپی اشتباه وارد کرده‌اید، چند دقیقه بعد دوباره امتحان کنید.";

/** The sentence a person sees for a refused sign-in. */
export function loginMessage(reason: LoginReason, appName: string): string {
  switch (reason) {
    case "empty_password":
      return "گذرواژه را وارد کنید";
    case "bad_login":
      return "نام کاربری را به یکی از شکل‌های ali، CORP\\ali یا ali@corp.example بنویسید";
    case "unknown_domain":
      return "این دامنه برای ورود تعریف نشده است؛ نام دامنه را بررسی کنید";
    case "ambiguous_domain":
    case "no_source":
      return "نام دامنه را هم بنویسید (مانند CORP\\ali یا ali@corp.example)";
    case "rate_limited":
      return "تلاش‌ها بیش از اندازه است؛ چند دقیقه بعد دوباره امتحان کنید";
    case "disabled":
      return "حساب سازمانی شما غیرفعال است؛ با واحد فناوری اطلاعات تماس بگیرید";
    case "account_expired":
      return "اعتبار حساب سازمانی شما به پایان رسیده است؛ با واحد فناوری اطلاعات تماس بگیرید";
    case "password_expired":
      return "گذرواژهٔ حساب سازمانی شما منقضی شده است؛ پیش از ورود، آن را در ویندوز (Ctrl+Alt+Del ← تغییر گذرواژه) عوض کنید";
    case "must_change":
      return "پیش از نخستین ورود باید گذرواژهٔ حساب سازمانی‌تان را عوض کنید؛ یک بار در ویندوز (Ctrl+Alt+Del) آن را تغییر دهید و دوباره وارد شوید";
    case "logon_hours":
      return "حساب سازمانی شما در این ساعت اجازهٔ ورود ندارد";
    case "workstation":
      return "حساب سازمانی شما از این رایانه اجازهٔ ورود ندارد";
    case "member_disabled":
      return `دسترسی شما به ${appName} غیرفعال شده است؛ با مدیر سامانه تماس بگیرید`;
    case "jit_disabled":
      return `حساب سازمانی شما هنوز در ${appName} تعریف نشده است؛ با مدیر سامانه تماس بگیرید`;
    case "no_email":
      return "حساب سازمانی شما نشانی ایمیل ندارد؛ با واحد فناوری اطلاعات تماس بگیرید";
    case "account_conflict":
    case "reserved_email":
      return `حسابی با ایمیل شما پیش‌تر در ${appName} هست و با حساب سازمانی پیوند نخورده است؛ با مدیر سامانه تماس بگیرید`;
    case "dc_unreachable":
      return "سرور دامنه اکنون در دسترس نیست؛ کمی بعد دوباره امتحان کنید یا با مدیر سامانه تماس بگیرید";
    case "tls":
    case "config":
    case "service_bind":
    case "not_approved":
    case "feature_off":
      return "ورود با حساب سازمانی هنوز درست پیکربندی نشده است؛ با مدیر سامانه تماس بگیرید";
    case "sso_unavailable":
      return "ورود خودکار ویندوز روی این سرور در دسترس نیست؛ با نام کاربری و گذرواژهٔ سازمانی وارد شوید";
    case "sso_failed":
    case "proxy_untrusted":
    case "proxy_secret":
    case "ntlm_refused":
      return "ورود خودکار ویندوز انجام نشد؛ با نام کاربری و گذرواژهٔ سازمانی وارد شوید";
    case "local_disabled":
      return "ورود با ایمیل و رمز عبور برای این حساب بسته است؛ با حساب سازمانی وارد شوید";
    default:
      return GENERIC_LOGIN_MESSAGE;
  }
}

/** Short Persian labels of reasons (the sign-in audit). */
export const REASON_LABELS: Record<LoginReason | "ok", string> = {
  ok: "ورود موفق",
  empty_password: "گذرواژهٔ خالی",
  bad_login: "نام کاربری نامعتبر",
  unknown_domain: "دامنهٔ ناشناخته",
  ambiguous_domain: "دامنهٔ مبهم",
  no_source: "بدون منبع ورود",
  unknown_account: "حساب پیدا نشد",
  ambiguous_account: "چند حساب با یک نام",
  wrong_password: "گذرواژهٔ نادرست",
  locked: "حساب در دامنه قفل است",
  throttled: "قفل محلی پس از تلاش‌های ناموفق",
  rate_limited: "تلاش‌های بیش از اندازه از یک نشانی",
  disabled: "حساب در دامنه غیرفعال است",
  account_expired: "اعتبار حساب تمام شده",
  password_expired: "گذرواژه منقضی شده",
  must_change: "باید گذرواژه عوض شود",
  logon_hours: "بیرون از ساعت مجاز",
  workstation: "رایانهٔ غیرمجاز",
  member_disabled: "عضویت غیرفعال",
  jit_disabled: "عضو تعریف نشده (ساخت خودکار خاموش)",
  no_email: "حساب بدون ایمیل",
  account_conflict: "حساب محلی با همین ایمیل",
  reserved_email: "نشانی رزروشده",
  dc_unreachable: "سرور دامنه در دسترس نبود",
  tls: "خطای گواهی یا TLS",
  config: "پیکربندی ناقص",
  service_bind: "حساب خدمت پذیرفته نشد",
  not_approved: "منبع تأیید نشده",
  feature_off: "قابلیت خاموش",
  sso_failed: "ورود خودکار ناموفق",
  sso_unavailable: "ورود خودکار در دسترس نیست",
  proxy_untrusted: "سرآیند از نشانی نامعتبر",
  proxy_secret: "راز پراکسی نادرست",
  ntlm_refused: "NTLM پذیرفته نیست",
  local_disabled: "ورود محلی بسته است",
};

export const METHOD_LABELS: Record<string, string> = {
  password: "ایمیل و رمز عبور",
  ldap: "حساب سازمانی",
  sso: "ورود خودکار ویندوز",
  proxy: "ورود ویندوز از راه IIS",
  device: "برنامهٔ ویندوز",
  signup: "ثبت‌نام",
  recover: "بازیابی",
};

// ---------------------------------------------------------------- the SSO checklist

/**
 * The SPN commands for a host name and the Windows account the service runs as (run by a domain administrator):
 * look for duplicates first (a duplicate SPN breaks Kerberos for everyone), then register the full and the short name.
 */
export function spnCommands(host: string, account: string): string[] {
  const h = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  const a = account.trim();
  if (!h || !a) return [];
  const short = h.includes(".") ? h.split(".")[0] : null;
  return [`setspn -Q HTTP/${h}`, `setspn -S HTTP/${h} ${a}`, ...(short ? [`setspn -S HTTP/${short} ${a}`] : [])];
}
