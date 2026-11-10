// «ورود با حساب سازمانی» (docs/AD_FA.md): a person signs in with their domain account through a directory source.
//   1. route    the login name's domain (CORP\ali, ali@corp.bank.ir) picks the source; a bare name needs a single
//               source. On an installation with several organisations a source is reached only through its own sign-in
//               link (?dir=<source>) — a domain typed on a shared sign-in page never sends a password to an
//               organisation's directory.
//   2. verify   over LDAPS or StartTLS (the organisation's root CA, the server's name; plaintext only when the source
//               says «فقط برای آزمایش»), domain controllers in order: the service account finds the person (every typed
//               value escaped per RFC 4515), the account's state is read (a locked account is refused without asking the
//               DC to check a password), then the person binds with their password on a connection of their own.
//               Disabled, expired, password-expired and must-change accounts are refused with their own message only
//               once the password was proven right (AD's sub-codes 533/701/532/773 come only then).
//   3. groups   nested membership through LDAP_MATCHING_RULE_IN_CHAIN (memberOf when the server does not know it).
//   4. member   the directory link (sm_directory_links) or the e-mail finds the member; a first sign-in creates one
//               (just-in-time, as the member who approved the source — never the system) with the source's default
//               role; name, e-mail, phone, title, unit (department or a mapped group) and manager are refreshed; mapped
//               groups, roles and workspaces are granted only while the source's automatic roles are on and its
//               mappings are the ones an administrator approved (otherwise they wait, listed as pending), and what a
//               mapping granted is taken back when the person leaves the directory group.
// Single sign-on (Kerberos, a trusted proxy) proves who the person is and joins at step 2 without a password.
import type { Ctx, ServerConfig } from "../../context";
import { createHash } from "node:crypto";
import { tableDef } from "@shared/tables";
import { isEmail, isReservedEmail } from "@shared/validate";
import { attrMapOf, cnOf, entryFromLdap, groupMatches, mappedAccess, type AttrMap, type GroupMapping } from "@shared/integration/directory";
import { accountState, domainMatches, parseLogin, reasonOfAdCode, spnCommands, type LoginReason, type ParsedLogin } from "@shared/auth/login";
import { createIn, readSecret, removeIn, systemCtx } from "../../engine";
import { addGroupMembers, memberCtx, saveMemberAccess } from "../../access";
import { AppError, bad, notFound } from "../../http/errors";
import { isSystem } from "../../access/provider";
import { needRecentAuth } from "../../auth/policy";
import { negotiateProblem } from "../../auth/sso";
import type { WriteArgs } from "../../engine";
import { ensurePerson } from "../admin/members";
import { hasFeature, needWithinLimit } from "../admin/common";
import { caProblem, connectAny, escapeFilterValue, IN_CHAIN, LdapClient, LdapError, type LdapEntry, type LdapOptions } from "./ldap";
import { grantingGroups, liveRow, liveRows, needIntegrations, sysOf, type Row } from "./common";
import { guardHost, mappingsOf, optionsOf } from "./directory";

/** A refused sign-in: the reason (audit), an administrator's detail (never a password), and what is known so far. */
export class LoginFailure extends Error {
  constructor(
    public reason: LoginReason,
    public detail: string | null = null,
    public known: { org_id?: string | null; source_id?: string | null; user_id?: string | null; dc?: string | null; external_id?: string | null } = {},
  ) {
    super(detail ?? reason);
  }
}

const fail = (reason: LoginReason, detail: string | null = null, known: LoginFailure["known"] = {}) => new LoginFailure(reason, detail, known);

// ---------------------------------------------------------------- the source

export type TlsMode = "ldaps" | "starttls" | "none";

export interface LoginSourceConfig {
  id: string;
  orgId: string;
  name: string;
  urls: string[];
  tls: TlsMode | "legacy";
  ca: string | null;
  bindDn: string;
  baseDn: string;
  groupBaseDn: string;
  userFilter: string;
  loginAttr: "sAMAccountName" | "userPrincipalName" | "mail";
  domains: string[];
  nested: boolean;
  jit: boolean;
  timeoutMs: number;
  map: AttrMap;
  mappings: GroupMapping[];
  defaultRole: string | null;
  membership: "member" | "viewer";
  unitFromDepartment: boolean;
  approvedBy: string | null;
  /** mapped roles, groups that grant access and workspaces may be granted at sign-in */
  rolesApproved: boolean;
  ssoMode: "off" | "negotiate" | "proxy";
  ssoAuto: boolean;
  ntlm: boolean;
  proxyHeader: string;
  proxyIps: string[];
  loginEnabled: boolean;
}

const lines = (v: unknown) =>
  String(v ?? "")
    .split(/[\r\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** The fingerprint of what an approval covers: mappings, the default role and membership, automatic roles. */
export function mappingFingerprint(src: Row): string {
  const m = mappingsOf(src)
    .map((x) => ({ s: x.source.toLowerCase(), g: x.group_id ?? null, r: x.role ?? null, u: x.unit_id ?? null, w: x.workspace_id ?? null }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const o = optionsOf(src);
  return createHash("sha256")
    .update(JSON.stringify({ m, d: o.default_role, a: o.auto_roles, ms: src.membership_role === "member" ? "member" : "viewer" }))
    .digest("hex")
    .slice(0, 32);
}

/** The effective TLS mode of a source (rows saved before sign-in existed follow their URL). */
export function tlsModeOf(src: Row): TlsMode | "legacy" {
  const m = String(src.tls_mode ?? "");
  if (m === "ldaps" || m === "starttls" || m === "none") return m;
  const urls = [src.ldap_url, ...lines(src.dc_urls)].filter(Boolean).map(String);
  return urls.length && urls.every((u) => /^ldaps:\/\//i.test(u)) ? "ldaps" : "legacy";
}

export function sourceConfig(src: Row): LoginSourceConfig {
  const loginAttr = src.login_attr === "userPrincipalName" || src.login_attr === "mail" ? src.login_attr : "sAMAccountName";
  const sso = src.sso_mode === "negotiate" || src.sso_mode === "proxy" ? src.sso_mode : "off";
  const o = optionsOf(src);
  return {
    id: String(src.id),
    orgId: String(src.org_id),
    name: String(src.name ?? ""),
    urls: [String(src.ldap_url ?? "").trim(), ...lines(src.dc_urls)].filter(Boolean),
    tls: tlsModeOf(src),
    ca: typeof src.ca_cert === "string" && src.ca_cert.trim() ? src.ca_cert : null,
    bindDn: String(src.bind_dn ?? ""),
    baseDn: String(src.base_dn ?? ""),
    groupBaseDn: String(src.group_base_dn ?? "").trim() || String(src.base_dn ?? ""),
    userFilter: String(src.user_filter || "(&(objectCategory=person)(objectClass=user))"),
    loginAttr,
    domains: (Array.isArray(src.login_domains) ? src.login_domains : []).map((d: unknown) => String(d).trim()).filter(Boolean),
    nested: src.nested_groups !== false,
    jit: src.jit !== false,
    timeoutMs: Math.min(60, Math.max(2, Number(src.timeout_seconds ?? 10) || 10)) * 1000,
    map: attrMapOf(src.attr_map),
    mappings: mappingsOf(src),
    defaultRole: o.default_role,
    membership: src.membership_role === "member" ? "member" : "viewer",
    unitFromDepartment: o.unit_from === "department",
    approvedBy: typeof src.approved_by === "string" && src.approved_by ? src.approved_by : null,
    rolesApproved: !!src.auto_roles && !!src.approved_map_hash && src.approved_map_hash === mappingFingerprint(src),
    ssoMode: sso,
    ssoAuto: !!src.sso_auto,
    ntlm: !!src.ntlm,
    proxyHeader: String(src.proxy_header || "X-Remote-User"),
    proxyIps: lines(src.proxy_ips),
    loginEnabled: !!src.login_enabled,
  };
}

/** Connection options for a source (passwords travel only over TLS unless the source is a test one). */
async function connectionOptions(cfg: ServerConfig, sys: Ctx, conf: LoginSourceConfig, purpose: "login" | "sync"): Promise<Omit<LdapOptions, "url">> {
  if (!conf.urls.length || !conf.baseDn) throw fail("config", "نشانی LDAP و ریشهٔ جست‌وجو را تنظیم کنید");
  if (conf.tls === "ldaps" && conf.urls.some((u) => !/^ldaps:\/\//i.test(u))) throw fail("config", "با LDAPS همهٔ نشانی‌ها باید با ldaps:// شروع شوند");
  if (conf.tls === "legacy" && purpose === "login") throw fail("config", "رمزنگاری اتصال (LDAPS یا StartTLS) را برای ورود با حساب سازمانی تعیین کنید");
  for (const u of conf.urls) await guardHost(cfg, u).catch((e) => {
    throw fail("config", String((e as Error).message ?? e));
  });
  const password = (await readSecret(cfg.db, sys, tableDef("directory_source")!, conf.id, "bind_password")) ?? "";
  if (!conf.bindDn || !password) throw fail("config", "حساب خدمت (Bind DN) و گذرواژهٔ آن را تنظیم کنید");
  return {
    bindDn: conf.bindDn,
    password,
    ca: conf.ca,
    // ldap:// addresses are upgraded with StartTLS; ldaps:// ones speak TLS from the first byte
    startTls: conf.tls === "starttls",
    requireTls: conf.tls === "ldaps" || conf.tls === "starttls",
    timeoutMs: conf.timeoutMs,
  };
}

/** The domain controllers that answered last come first (per source, per server process). */
const preferred = new Map<string, string>();
const ordered = (conf: LoginSourceConfig) => {
  const p = preferred.get(conf.id);
  return p && conf.urls.includes(p) ? [p, ...conf.urls.filter((u) => u !== p)] : conf.urls;
};

const asFailure = (e: unknown, stage: "connect" | "service" | "search" | "user", known: LoginFailure["known"] = {}): LoginFailure => {
  if (e instanceof LoginFailure) return e;
  if (e instanceof LdapError) {
    if (e.kind === "network" || e.kind === "protocol") return fail("dc_unreachable", e.message, known);
    if (e.kind === "tls") return fail("tls", e.message, known);
    if (e.kind === "input") return fail("config", e.message, known);
    if (stage === "service") return fail("service_bind", e.message, known);
    return fail("config", e.message, known);
  }
  return fail("config", String((e as Error)?.message ?? e), known);
};

/** Open a service-account connection: the first domain controller that answers, bound as the service account. */
async function serviceConnection(cfg: ServerConfig, sys: Ctx, conf: LoginSourceConfig, purpose: "login" | "sync" = "login"): Promise<{ client: LdapClient; url: string; options: Omit<LdapOptions, "url"> }> {
  const known = { org_id: conf.orgId, source_id: conf.id };
  const options = await connectionOptions(cfg, sys, conf, purpose);
  let conn: { client: LdapClient; url: string };
  try {
    conn = await connectAny(ordered(conf), options);
  } catch (e) {
    throw asFailure(e, "connect", known);
  }
  preferred.set(conf.id, conn.url);
  try {
    await conn.client.bind();
  } catch (e) {
    conn.client.close();
    throw asFailure(e, "service", { ...known, dc: hostOf(conn.url) });
  }
  return { ...conn, options };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const STATE_ATTRS = ["userAccountControl", "lockoutTime", "accountExpires", "pwdLastSet", "msDS-UserPasswordExpiryTimeComputed", "msDS-User-Account-Control-Computed"];

function userAttributes(map: AttrMap): string[] {
  return [...new Set([map.email, map.name, map.username, map.title, map.phone, map.department, map.manager, map.groups, map.id, map.disabled, "userPrincipalName", "sAMAccountName", "mail", "cn", "displayName", ...STATE_ATTRS])].filter(
    (a) => a && !["distinguishedname", "dn"].includes(a.toLowerCase()),
  );
}

const wrap = (f: string) => (f.trim().startsWith("(") ? f.trim() : `(${f.trim()})`);

/** The filter that finds the person a login name names, within the source's user filter (values escaped). */
export function loginFilter(conf: Pick<LoginSourceConfig, "userFilter" | "loginAttr" | "domains">, login: ParsedLogin): string {
  const v = escapeFilterValue;
  let who: string;
  if (login.form === "netbios") who = `(sAMAccountName=${v(login.name)})`;
  else if (login.form === "upn") {
    const full = `${login.name}@${login.domain}`;
    who = `(|(userPrincipalName=${v(full)})(mail=${v(full)}))`;
  } else if (conf.loginAttr === "sAMAccountName") who = `(sAMAccountName=${v(login.name)})`;
  else {
    const dns = conf.domains.find((d) => d.includes("."));
    who = `(${conf.loginAttr}=${v(dns ? `${login.name}@${dns}` : login.name)})`;
  }
  return `(&${wrap(conf.userFilter)}${who})`;
}

/** The filter of a single-sign-on principal (DOMAIN\name or name@REALM): the Windows account name, or the UPN. */
export function principalFilter(conf: Pick<LoginSourceConfig, "userFilter">, name: string, domain: string | null): string {
  const v = escapeFilterValue;
  const who = domain && domain.includes(".") ? `(|(sAMAccountName=${v(name)})(userPrincipalName=${v(`${name}@${domain}`)}))` : `(sAMAccountName=${v(name)})`;
  return `(&${wrap(conf.userFilter)}${who})`;
}

export interface DirectoryIdentity {
  entry: LdapEntry;
  /** directory groups (DNs), nested ones included */
  groups: string[];
  /** the manager's e-mail when the directory names a manager */
  managerEmail: string | null;
  dc: string;
}

async function findPerson(client: LdapClient, conf: LoginSourceConfig, filter: string, known: LoginFailure["known"]): Promise<LdapEntry> {
  let found: LdapEntry[];
  try {
    found = await client.search(conf.baseDn, filter, userAttributes(conf.map), { max: 2 });
  } catch (e) {
    throw asFailure(e, "search", known);
  }
  if (!found.length) throw fail("unknown_account", null, known);
  if (found.length > 1) throw fail("ambiguous_account", `${found.length} حساب با این نام پیدا شد`, known);
  const entry = found[0];
  // constructed attributes (msDS-User-Account-Control-Computed…) come only from a read of the entry itself
  try {
    const [base] = await client.search(entry.dn, "(objectClass=*)", STATE_ATTRS, { scope: 0, max: 1 });
    if (base) for (const [k, vals] of Object.entries(base.attrs)) entry.attrs[k] = vals;
  } catch {
    /* the subtree answer is enough */
  }
  return entry;
}

async function groupsOf(client: LdapClient, conf: LoginSourceConfig, entry: LdapEntry): Promise<string[]> {
  const direct = (Object.entries(entry.attrs).find(([k]) => k.toLowerCase() === conf.map.groups.toLowerCase())?.[1] ?? []).slice(0, 5000);
  if (!conf.nested) return direct;
  try {
    const rows = await client.search(conf.groupBaseDn, `(&(objectClass=group)(member:${IN_CHAIN}:=${escapeFilterValue(entry.dn)}))`, ["cn"], { max: 5000 });
    return [...new Set([...rows.map((r) => r.dn), ...direct])];
  } catch {
    // a directory without LDAP_MATCHING_RULE_IN_CHAIN (OpenLDAP…): direct memberships only
    return direct;
  }
}

async function managerEmailOf(client: LdapClient, conf: LoginSourceConfig, entry: LdapEntry): Promise<string | null> {
  const dn = Object.entries(entry.attrs).find(([k]) => k.toLowerCase() === conf.map.manager.toLowerCase())?.[1]?.[0];
  if (!dn) return null;
  try {
    const [m] = await client.search(dn, "(objectClass=*)", [conf.map.email, "userPrincipalName"], { scope: 0, max: 1 });
    if (!m) return null;
    return entryFromLdap(m.dn, m.attrs, conf.map).email;
  } catch {
    return null;
  }
}

/** Refusals the account's state gives once the person is known to be who they say. */
function stateRefusal(conf: LoginSourceConfig, entry: LdapEntry, base: LoginFailure["known"]): LoginFailure | null {
  const s = accountState(entry.attrs);
  const known = { ...base, external_id: entryFromLdap(entry.dn, entry.attrs, conf.map).external_id };
  if (s.disabled) return fail("disabled", null, known);
  if (s.expired) return fail("account_expired", null, known);
  if (s.mustChange) return fail("must_change", null, known);
  if (s.passwordExpired) return fail("password_expired", null, known);
  return null;
}

/** Check a password with the domain: the person's entry, their state, a bind as them, their groups. */
export async function verifyDirectoryPassword(cfg: ServerConfig, sys: Ctx, conf: LoginSourceConfig, login: ParsedLogin, password: string): Promise<DirectoryIdentity> {
  const known: LoginFailure["known"] = { org_id: conf.orgId, source_id: conf.id };
  // an empty simple bind is an unauthenticated bind that «succeeds»: refused before any domain controller is asked
  if (typeof password !== "string" || password.length === 0) throw fail("empty_password", null, known);
  const { client, url, options } = await serviceConnection(cfg, sys, conf);
  known.dc = hostOf(url);
  try {
    const entry = await findPerson(client, conf, loginFilter(conf, login), known);
    // locked out now: the domain is not asked to check a password (it would only extend the lockout)
    if (accountState(entry.attrs).locked) throw fail("locked", null, known);
    const user = new LdapClient({ ...options, url });
    try {
      await user.connect();
      await user.bindAs(entry.dn, password);
    } catch (e) {
      if (e instanceof LdapError && e.kind === "result" && e.code === 49) {
        const reason = reasonOfAdCode(e.ad);
        throw fail(reason, null, reason === "wrong_password" || reason === "locked" ? known : { ...known, external_id: entryFromLdap(entry.dn, entry.attrs, conf.map).external_id });
      }
      throw asFailure(e, "user", known);
    } finally {
      user.close();
    }
    const refused = stateRefusal(conf, entry, known);
    if (refused) throw refused;
    return { entry, groups: await groupsOf(client, conf, entry), managerEmail: await managerEmailOf(client, conf, entry), dc: known.dc };
  } finally {
    client.close();
  }
}

/** A person single sign-on vouched for (no password): their entry, state and groups. */
export async function directoryIdentity(cfg: ServerConfig, sys: Ctx, conf: LoginSourceConfig, name: string, domain: string | null): Promise<DirectoryIdentity> {
  const known: LoginFailure["known"] = { org_id: conf.orgId, source_id: conf.id };
  const { client, url } = await serviceConnection(cfg, sys, conf);
  known.dc = hostOf(url);
  try {
    const entry = await findPerson(client, conf, principalFilter(conf, name, domain), known);
    if (accountState(entry.attrs).locked) throw fail("locked", null, known);
    const refused = stateRefusal(conf, entry, known);
    if (refused) throw refused;
    return { entry, groups: await groupsOf(client, conf, entry), managerEmail: await managerEmailOf(client, conf, entry), dc: known.dc };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------- routing

interface SourceRef {
  id: string;
  org_id: string;
  login_domains: unknown;
  sso_mode: string | null;
}

/** Sources people may sign in through (login on, LDAP, active, organisation alive). */
export async function loginSources(cfg: ServerConfig): Promise<SourceRef[]> {
  return cfg.db.query<SourceRef>(
    `select s.id, s.org_id, s.login_domains, s.sso_mode from sm_directory_sources s join sm_orgs o on o.id = s.org_id and o.deleted_at is null
     where s.deleted_at is null and s.kind = 'ldap' and s.active and s.login_enabled order by s.created_at, s.id`,
  );
}

/** The source a login name is for (see the header: domains, a single source, the organisation's own link). */
export async function routeLogin(cfg: ServerConfig, login: ParsedLogin, hint: string | null | undefined, sso: "negotiate" | "proxy" | null = null): Promise<SourceRef> {
  let all = await loginSources(cfg);
  if (sso) all = all.filter((s) => s.sso_mode === sso);
  if (hint) {
    const s = all.find((x) => x.id === hint.toLowerCase());
    if (!s) throw fail("no_source");
    const domains = Array.isArray(s.login_domains) ? s.login_domains : [];
    if (login.domain && domains.length && !domainMatches(login.domain, domains)) throw fail("unknown_domain", null, { org_id: s.org_id, source_id: s.id });
    return s;
  }
  if (!all.length) throw fail("no_source");
  // several organisations sign in through their directories here: each through its own link
  if (new Set(all.map((s) => s.org_id)).size > 1 && !sso) throw fail("no_source");
  if (login.domain) {
    const m = all.filter((s) => domainMatches(login.domain, s.login_domains));
    if (m.length === 1) return m[0];
    if (m.length > 1) throw fail("ambiguous_domain");
    if (all.length === 1 && !(Array.isArray(all[0].login_domains) && all[0].login_domains.length)) return all[0];
    throw fail("unknown_domain");
  }
  if (all.length === 1) return all[0];
  throw fail("ambiguous_domain");
}

/** A source ready for sign-in: its row, configuration and system context; refused while it is not usable. */
export async function loadLoginSource(cfg: ServerConfig, ref: Pick<SourceRef, "id" | "org_id">): Promise<{ src: Row; conf: LoginSourceConfig; sys: Ctx }> {
  const known = { org_id: ref.org_id, source_id: ref.id };
  const sys = await systemCtx(cfg, ref.org_id);
  const src = await liveRow(cfg.db, sys, "directory_source", ref.id);
  if (!src || src.active === false || src.kind !== "ldap" || !src.login_enabled) throw fail("no_source", null, known);
  if (!(await hasFeature(cfg.db, ref.org_id, "directory_sync", cfg.mode))) throw fail("feature_off", "همگام‌سازی LDAP برای این سازمان خاموش است", known);
  const conf = sourceConfig(src);
  if (!conf.approvedBy) throw fail("not_approved", "منبع هنوز از سوی مدیری تأیید نشده است («تأیید منبع با دسترسی من»)", known);
  return { src, conf, sys };
}

// ---------------------------------------------------------------- the member

export interface ProvisionResult {
  user_id: string;
  email: string;
  created: boolean;
  roles: string[];
  pending_roles: string[];
  groups_added: number;
  groups_removed: number;
  problems: string[];
}

interface Granted {
  roles: string[];
  groups: string[];
  workspaces: string[];
}

const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The member a verified directory identity is: linked, found by e-mail or created (just-in-time), with attributes
 * refreshed and approved mappings applied — always as the member who approved the source.
 */
export async function provisionMember(cfg: ServerConfig, conf: LoginSourceConfig, id: DirectoryIdentity): Promise<ProvisionResult> {
  const orgId = conf.orgId;
  const known: LoginFailure["known"] = { org_id: orgId, source_id: conf.id };
  const dir = entryFromLdap(id.entry.dn, id.entry.attrs, conf.map);
  const email = lower(dir.email);
  if (!email || !isEmail(email)) throw fail("no_email", null, known);
  if (isReservedEmail(email) || cfg.platformAdmins.includes(email)) throw fail("reserved_email", null, known);
  const db = cfg.db;
  const link = await db.one<{ local_id: string; granted: Granted | null }>(
    `select local_id, granted from sm_directory_links where source_id = $1 and kind = 'user' and external_id = $2 and active`,
    [conf.id, dir.external_id],
  );
  let userId: string | null = link?.local_id ?? null;
  if (userId && !(await db.one(`select 1 from sm_users where id = $1`, [userId]))) userId = null;
  if (!userId) {
    const existing = await db.one<{ id: string; is_platform_admin: boolean }>(`select id, is_platform_admin from sm_users where lower(email) = $1`, [email]);
    if (existing) {
      known.user_id = existing.id;
      // never take over an administrator of the platform, or an account that belongs to another organisation
      if (existing.is_platform_admin) throw fail("account_conflict", "حساب مدیر سامانه با ورود محلی کار می‌کند", known);
      const elsewhere = await db.one(`select 1 from sm_org_members where user_id = $1 and org_id <> $2 and deleted_at is null`, [existing.id, orgId]);
      if (elsewhere) throw fail("account_conflict", "این حساب عضو سازمان دیگری هم هست", known);
      userId = existing.id;
    }
  }
  known.user_id = userId;
  const member = userId ? await db.one<{ id: string; is_active: boolean }>(`select id, is_active from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, userId]) : null;
  if (member && !member.is_active) throw fail("member_disabled", null, known);
  if (!member && !conf.jit) throw fail("jit_disabled", null, known);
  const actx = await memberCtx(cfg, orgId, conf.approvedBy!).catch(() => null);
  if (!actx) throw fail("not_approved", "تأییدکنندهٔ منبع دیگر عضو فعال نیست؛ منبع را دوباره تأیید کنید", known);
  let created = false;
  if (!member) {
    try {
      await needWithinLimit(db, cfg, orgId, "members", 1);
    } catch (e) {
      throw fail("config", String((e as Error).message ?? e), known);
    }
    const r = await actx.write((tx) => ensurePerson(tx, actx, { email, name: dir.name || email, title: dir.title }, conf.membership));
    userId = r.user_id;
    created = r.created || r.joined;
    known.user_id = userId;
  }
  const uid = userId!;
  const problems: string[] = [];
  const wanted = mappedAccess(conf.mappings, id.groups);
  const prev: Granted = { roles: strings(link?.granted?.roles), groups: strings(link?.granted?.groups), workspaces: strings(link?.granted?.workspaces) };

  // the account: name, and e-mail when the directory's changed and nobody else has it
  const account = await db.one<{ email: string; full_name: string }>(`select email, full_name from sm_users where id = $1`, [uid]);
  if (dir.name && account && dir.name.slice(0, 120) !== account.full_name) await db.query(`update sm_users set full_name = $2 where id = $1`, [uid, dir.name.slice(0, 120)]);
  if (account && lower(account.email) !== email && !(await db.one(`select 1 from sm_users where lower(email) = $1 and id <> $2`, [email, uid]))) {
    await db.query(`update sm_users set email = $2 where id = $1`, [uid, email]);
  }

  // the profile: title, phone, unit, manager, roles, workspaces
  const profile = await db.one<{ roles: unknown; title: string | null; phone: string | null; org_unit_id: string | null; manager_id: string | null; workspaces: unknown }>(
    `select roles, title, phone, org_unit_id, manager_id, workspaces from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`,
    [orgId, uid],
  );
  const data: Record<string, unknown> = {};
  if (dir.title?.trim() && dir.title.trim().slice(0, 120) !== (profile?.title ?? "")) data.title = dir.title.trim().slice(0, 120);
  if (dir.phone?.trim() && dir.phone.trim().slice(0, 40) !== (profile?.phone ?? "")) data.phone = dir.phone.trim().slice(0, 40);
  const unitId = await unitFor(actx, conf, wanted.unit_id, dir.department ?? null, problems);
  if (unitId && unitId !== (profile?.org_unit_id ?? null)) data.org_unit_id = unitId;
  if (id.managerEmail) {
    const mgr = await db.one<{ user_id: string }>(
      `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and lower(u.email) = $2 and m.deleted_at is null`,
      [orgId, lower(id.managerEmail)],
    );
    if (mgr && mgr.user_id !== uid && mgr.user_id !== (profile?.manager_id ?? null)) data.manager_id = mgr.user_id;
  }
  const current = strings(profile?.roles);
  const approvedRoles = conf.rolesApproved ? wanted.roles.map((r) => r.role) : [];
  const pending = conf.rolesApproved ? [] : wanted.roles.map((r) => r.role).filter((r) => !current.includes(r) && r !== conf.defaultRole);
  let roles = created ? [...new Set([...(conf.defaultRole ? [conf.defaultRole] : []), ...current])] : [...current];
  for (const r of approvedRoles) if (!roles.includes(r)) roles.push(r);
  // a role a mapping granted is taken back when the person left the directory group (never the default role)
  if (conf.rolesApproved) roles = roles.filter((r) => !(prev.roles.includes(r) && !approvedRoles.includes(r) && r !== conf.defaultRole));
  if (JSON.stringify([...roles].sort()) !== JSON.stringify([...current].sort())) {
    data.roles = roles;
    if (created) data.persona = roles.every((r) => r === "requester") ? "requester" : "agent";
  }
  const currentWs = strings(profile?.workspaces);
  let workspaces = [...currentWs];
  if (conf.rolesApproved) {
    for (const w of wanted.workspaces) if (!workspaces.includes(w)) workspaces.push(w);
    workspaces = workspaces.filter((w) => !(prev.workspaces.includes(w) && !wanted.workspaces.includes(w)));
  } else for (const w of wanted.workspaces) if (!currentWs.includes(w)) pending.push(`workspace:${w}`);
  if (JSON.stringify([...workspaces].sort()) !== JSON.stringify([...currentWs].sort())) data.workspaces = workspaces;
  if (Object.keys(data).length) {
    try {
      await saveMemberAccess(actx, uid, data);
    } catch (e) {
      problems.push(String((e as Error).message ?? e).slice(0, 200));
      if (data.roles || data.workspaces) {
        // keep the attributes even when a grant is refused (the approver lost the right to grant it)
        const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "roles" && k !== "workspaces" && k !== "persona"));
        if (Object.keys(rest).length) await saveMemberAccess(actx, uid, rest).catch(() => undefined);
      }
    }
  }

  // mapped ITSM groups (one that grants roles or a workspace only once approved)
  let added = 0;
  let removed = 0;
  const granting = await grantingGroups(db, orgId, wanted.groups);
  const keptGroups: string[] = [];
  for (const g of wanted.groups) {
    if (granting.has(g) && !conf.rolesApproved) {
      pending.push(`group:${g}`);
      continue;
    }
    try {
      const r = await addGroupMembers(actx, g, [uid]);
      added += r.added;
      keptGroups.push(g);
    } catch (e) {
      problems.push(String((e as Error).message ?? e).slice(0, 200));
    }
  }
  const leaving = prev.groups.filter((g) => !wanted.groups.includes(g));
  if (leaving.length) {
    await actx.write(async (tx) => {
      for (const g of leaving) {
        const [row] = await liveRows(tx, sysOf(actx), "group_member", { and: [{ f: "group_id", op: "eq", v: g }, { f: "user_id", op: "eq", v: uid }] }, { limit: 1 });
        if (row) {
          await removeIn(tx, actx, "group_member", String(row.id));
          removed++;
        }
      }
    });
  }
  const granted: Granted = {
    roles: conf.rolesApproved ? approvedRoles.filter((r) => roles.includes(r) && r !== conf.defaultRole) : prev.roles,
    groups: [...new Set([...keptGroups, ...(conf.rolesApproved ? [] : prev.groups.filter((g) => wanted.groups.includes(g)))])],
    workspaces: conf.rolesApproved ? wanted.workspaces : prev.workspaces,
  };
  await db.query(
    `insert into sm_directory_links (org_id, source_id, kind, external_id, local_id, external_name, active, updated_at, granted) values ($1, $2, 'user', $3, $4, $5, true, now(), $6)
     on conflict (source_id, kind, external_id) do update set local_id = excluded.local_id, external_name = excluded.external_name, active = true, updated_at = now(), granted = excluded.granted`,
    [orgId, conf.id, dir.external_id, uid, email, granted],
  );
  return { user_id: uid, email, created, roles, pending_roles: [...new Set(pending)], groups_added: added, groups_removed: removed, problems };
}

/** The unit a person belongs to: a mapped group's unit, else (unit_from = department) the department's unit, made when missing. */
async function unitFor(actx: Ctx, conf: LoginSourceConfig, mapped: string | null, department: string | null, problems: string[]): Promise<string | null> {
  if (mapped) {
    const u = await liveRow(actx.db, sysOf(actx), "org_unit", mapped);
    if (u) return String(u.id);
  }
  if (!conf.unitFromDepartment || !department?.trim()) return null;
  const name = department.trim().slice(0, 150);
  const units = await liveRows(actx.db, sysOf(actx), "org_unit", null);
  const found = units.find((u) => lower(u.name) === lower(name));
  if (found) return String(found.id);
  try {
    const u = await actx.write((tx) => createIn(tx, actx, "org_unit", { name, kind: "department" }));
    return String(u.id);
  } catch (e) {
    problems.push(String((e as Error).message ?? e).slice(0, 200));
    return null;
  }
}

// ---------------------------------------------------------------- the administrator's tests (no password)

export interface LoginTestStep {
  key: string;
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface LoginTestReport {
  ok: boolean;
  steps: LoginTestStep[];
  person: { dn: string; name: string; email: string | null; username: string | null; title: string | null; department: string | null } | null;
  state: ReturnType<typeof accountState> | null;
  groups: { dn: string; name: string; mapped: boolean }[];
  access: { roles: { role: string; source: string }[]; groups: string[]; unit_id: string | null; workspaces: string[]; approved: boolean; default_role: string | null } | null;
  member: { user_id: string; active: boolean; linked: boolean } | null;
}

/**
 * «آزمایش ورود»: connect and bind with the service account, find a person by login name, show their account state,
 * resolved groups (nested ones too) and what the approved mappings would grant — without the person's password.
 */
export async function testLogin(ctx: Ctx, sourceId: string, loginText: string): Promise<LoginTestReport> {
  needIntegrations(ctx, "edit");
  const src = await liveRow(ctx.db, ctx, "directory_source", sourceId);
  if (!src || src.kind !== "ldap") throw notFound("منبع LDAP پیدا نشد");
  const conf = sourceConfig(src);
  const report: LoginTestReport = { ok: false, steps: [], person: null, state: null, groups: [], access: null, member: null };
  const step = (key: string, label: string, ok: boolean, detail: string | null = null) => report.steps.push({ key, label, ok, detail });
  const sys = sysOf(ctx);
  let conn: Awaited<ReturnType<typeof serviceConnection>>;
  try {
    conn = await serviceConnection(ctx.cfg, sys, conf, "login");
  } catch (e) {
    const f = asFailure(e, "connect");
    step(f.reason === "service_bind" ? "bind" : "connect", f.reason === "service_bind" ? "ورود حساب خدمت" : "اتصال به کنترل‌کنندهٔ دامنه", false, f.detail);
    return report;
  }
  step("connect", "اتصال به کنترل‌کنندهٔ دامنه", true, `${hostOf(conn.url)} — ${conn.client.encrypted ? "رمزنگاری‌شده (TLS)" : "بدون رمزنگاری"}`);
  step("bind", "ورود حساب خدمت", true, conf.bindDn);
  try {
    const login = parseLogin(loginText);
    if (!login) {
      step("search", "جست‌وجوی کاربر", false, "نام کاربری معتبر نیست");
      return report;
    }
    let entry: LdapEntry;
    try {
      entry = await findPerson(conn.client, conf, loginFilter(conf, login), {});
    } catch (e) {
      const f = asFailure(e, "search");
      step("search", "جست‌وجوی کاربر", false, f.reason === "unknown_account" ? "کاربری با این نام در ریشه و پالایهٔ جست‌وجو پیدا نشد" : f.detail);
      return report;
    }
    const dir = entryFromLdap(entry.dn, entry.attrs, conf.map);
    report.person = { dn: entry.dn, name: dir.name, email: dir.email, username: dir.username ?? null, title: dir.title ?? null, department: dir.department ?? null };
    report.state = accountState(entry.attrs);
    step("search", "جست‌وجوی کاربر", true, entry.dn);
    const groups = await groupsOf(conn.client, conf, entry);
    report.groups = groups.slice(0, 500).map((g) => ({ dn: g, name: cnOf(g), mapped: conf.mappings.some((m) => groupMatches(g, m.source)) }));
    step("groups", conf.nested ? "گروه‌ها (با گروه‌های تودرتو)" : "گروه‌ها", true, `${groups.length}`);
    const access = mappedAccess(conf.mappings, groups);
    report.access = { ...access, approved: conf.rolesApproved, default_role: conf.defaultRole };
    const link = await ctx.db.one<{ local_id: string }>(`select local_id from sm_directory_links where source_id = $1 and kind = 'user' and external_id = $2 and active`, [conf.id, dir.external_id]);
    const byEmail = dir.email ? await ctx.db.one<{ user_id: string; is_active: boolean }>(
      `select m.user_id, m.is_active from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and lower(u.email) = $2 and m.deleted_at is null`,
      [ctx.org.id, lower(dir.email)],
    ) : null;
    const memberRow = link ? await ctx.db.one<{ is_active: boolean }>(`select is_active from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, link.local_id]) : null;
    if (link) report.member = { user_id: link.local_id, active: !!memberRow?.is_active, linked: true };
    else if (byEmail) report.member = { user_id: byEmail.user_id, active: byEmail.is_active, linked: false };
    report.ok = true;
    return report;
  } finally {
    conn.client.close();
  }
}

export interface MappingPreviewRow {
  source: string;
  group_id: string | null;
  role: string | null;
  unit_id: string | null;
  workspace_id: string | null;
  found: boolean;
  members: number;
  sample: string[];
}

/** «پیش‌نمایش نگاشت‌ها»: per mapping, the directory group and how many people (nested members too) it would reach. */
export async function mappingPreview(ctx: Ctx, sourceId: string): Promise<{ approved: boolean; changed: boolean; rows: MappingPreviewRow[] }> {
  needIntegrations(ctx, "view");
  const src = await liveRow(ctx.db, ctx, "directory_source", sourceId);
  if (!src || src.kind !== "ldap") throw notFound("منبع LDAP پیدا نشد");
  const conf = sourceConfig(src);
  const rows: MappingPreviewRow[] = [];
  let conn: Awaited<ReturnType<typeof serviceConnection>>;
  try {
    conn = await serviceConnection(ctx.cfg, sysOf(ctx), conf, "sync");
  } catch (e) {
    throw new AppError(400, "directory", asFailure(e, "connect").detail ?? "اتصال به کنترل‌کنندهٔ دامنه نشد");
  }
  try {
    for (const m of conf.mappings.slice(0, 100)) {
      const row: MappingPreviewRow = { source: m.source, group_id: m.group_id, role: m.role ?? null, unit_id: m.unit_id ?? null, workspace_id: m.workspace_id ?? null, found: false, members: 0, sample: [] };
      try {
        const isDn = /^\s*cn=/i.test(m.source);
        const [g] = isDn
          ? await conn.client.search(m.source, "(objectClass=group)", ["cn"], { scope: 0, max: 1 }).catch(() => [])
          : await conn.client.search(conf.groupBaseDn, `(&(objectClass=group)(cn=${escapeFilterValue(cnOf(m.source))}))`, ["cn"], { max: 1 });
        if (g) {
          row.found = true;
          const rule = conf.nested ? `memberOf:${IN_CHAIN}:` : "memberOf";
          const people = await conn.client.search(conf.baseDn, `(&${wrap(conf.userFilter)}(${rule}=${escapeFilterValue(g.dn)}))`, [conf.map.name, "cn"], { max: 1000 });
          row.members = people.length;
          row.sample = people.slice(0, 5).map((p) => entryFromLdap(p.dn, p.attrs, conf.map).name || cnOf(p.dn));
        }
      } catch {
        /* reported as not found */
      }
      rows.push(row);
    }
  } finally {
    conn.client.close();
  }
  return { approved: conf.rolesApproved, changed: !!src.approved_map_hash && src.approved_map_hash !== mappingFingerprint(src), rows };
}

// ---------------------------------------------------------------- the synchronisation's connection

/**
 * A service-account connection for the directory synchronisation (same domain controllers, TLS and root CA as sign-in;
 * a source saved before sign-in existed keeps its plain ldap:// address). Errors come back as Persian AppErrors.
 */
export async function openSourceConnection(cfg: ServerConfig, sys: Ctx, src: Row): Promise<{ client: LdapClient; url: string; conf: LoginSourceConfig }> {
  const conf = sourceConfig(src);
  try {
    const { client, url } = await serviceConnection(cfg, sys, conf, "sync");
    return { client, url, conf };
  } catch (e) {
    throw new AppError(400, "directory", asFailure(e, "connect").detail ?? "اتصال به سرور LDAP نشد");
  }
}

/**
 * Nested memberships of the mapped groups (one LDAP_MATCHING_RULE_IN_CHAIN search per mapping, not one per person):
 * person DN (lower case) → the mapped groups' DNs they belong to through other groups.
 */
export async function nestedMemberships(client: LdapClient, conf: LoginSourceConfig): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!conf.nested) return out;
  for (const m of conf.mappings.slice(0, 100)) {
    try {
      const isDn = /^\s*cn=/i.test(m.source);
      const [g] = isDn
        ? await client.search(m.source, "(objectClass=group)", ["cn"], { scope: 0, max: 1 }).catch(() => [])
        : await client.search(conf.groupBaseDn, `(&(objectClass=group)(cn=${escapeFilterValue(cnOf(m.source))}))`, ["cn"], { max: 1 });
      if (!g) continue;
      const people = await client.search(conf.baseDn, `(memberOf:${IN_CHAIN}:=${escapeFilterValue(g.dn)})`, ["cn"], { max: 50_000 });
      for (const p of people) {
        const k = p.dn.toLowerCase();
        out.set(k, [...new Set([...(out.get(k) ?? []), g.dn])]);
      }
    } catch {
      /* a directory without the matching rule: direct memberships only */
    }
  }
  return out;
}

// ---------------------------------------------------------------- saving a source

/** Fields whose change is sensitive administration (they decide who signs in and with what access). */
const SENSITIVE_FIELDS = [
  "login_enabled", "login_domains", "tls_mode", "ldap_url", "dc_urls", "ca_cert", "bind_dn", "bind_password", "base_dn", "user_filter", "login_attr", "group_base_dn", "nested_groups",
  "group_map", "default_role", "membership_role", "auto_roles", "jit", "sso_mode", "proxy_ips", "proxy_secret", "proxy_header", "ntlm", "attr_map",
];

/**
 * Checks of a directory source's sign-in settings when it is saved (the record engine's hook): addresses and the TLS
 * mode agree, the root CA is a certificate, proxy addresses and the header name are sound, domains are names — and a
 * change of what decides who signs in (or with what access) needs a recent proof of identity.
 */
export function validateLoginSettings(w: WriteArgs): void {
  if (w.op !== "create" && w.op !== "update") return;
  const n = w.next;
  if (n.kind !== "ldap") return;
  if (w.op === "update" && !isSystem(w.ctx) && !w.trusted && SENSITIVE_FIELDS.some((f) => w.changed.has(f))) needRecentAuth(w.ctx);
  const problem = caProblem(n.ca_cert as string | null);
  if (problem) throw bad(problem);
  const urls = [String(n.ldap_url ?? "").trim(), ...lines(n.dc_urls)].filter(Boolean);
  for (const u of urls) if (!/^ldaps?:\/\/[^\s/]+/i.test(u)) throw bad(`نشانی «${u.slice(0, 80)}» باید با ldap:// یا ldaps:// شروع شود`);
  if (n.tls_mode === "ldaps" && urls.some((u) => !/^ldaps:/i.test(u))) throw bad("با LDAPS همهٔ نشانی‌ها باید با ldaps:// (درگاه ۶۳۶) شروع شوند");
  if (n.tls_mode === "starttls" && urls.some((u) => !/^ldap:/i.test(u))) throw bad("StartTLS روی نشانی‌های ldap:// (درگاه ۳۸۹) کار می‌کند");
  for (const ip of lines(n.proxy_ips)) if (!/^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]+)$/i.test(ip)) throw bad(`نشانی پراکسی «${ip.slice(0, 60)}» معتبر نیست (یک نشانی IP یا شبکه مانند 10.0.0.0/24)`);
  if (n.proxy_header && !/^[A-Za-z][A-Za-z0-9-]{0,79}$/.test(String(n.proxy_header))) throw bad("نام سرآیند کاربر پراکسی معتبر نیست");
  for (const d of Array.isArray(n.login_domains) ? n.login_domains : []) {
    if (!parseLogin(`x@${String(d)}`) && !parseLogin(`${String(d)}\\x`)) throw bad(`دامنهٔ «${String(d).slice(0, 60)}» معتبر نیست`);
  }
  if (n.sso_host && !/^[A-Za-z0-9.-]{1,200}$/.test(String(n.sso_host))) throw bad("نام میزبان سامانه فقط نام دامنه است (مانند kariz.bank.ir)");
}

// ---------------------------------------------------------------- the SSO checklist and the source's sign-ins

export interface SsoChecklist {
  mode: LoginSourceConfig["ssoMode"];
  host: string;
  account: string;
  spn: string[];
  negotiate: { available: boolean; problem: string | null };
  proxy: { header: string; ips: string[]; secret: boolean; secret_header: string };
  checks: { key: string; label: string; ok: boolean }[];
}

/** «راه‌اندازی ورود خودکار ویندوز»: what is set, what is missing, and the exact SPN commands for this host. */
export async function ssoChecklist(ctx: Ctx, sourceId: string, requestHost: string): Promise<SsoChecklist> {
  needIntegrations(ctx, "view");
  const src = await liveRow(ctx.db, ctx, "directory_source", sourceId);
  if (!src || src.kind !== "ldap") throw notFound("منبع LDAP پیدا نشد");
  const conf = sourceConfig(src);
  const host = String(src.sso_host ?? "").trim() || requestHost.replace(/:\d+$/, "");
  const account = String(src.sso_account ?? "").trim();
  const secret = !!(await ctx.db.one(`select 1 from sm_directory_sources where id = $1 and org_id = $2 and proxy_secret is not null and proxy_secret <> ''`, [sourceId, ctx.org.id]));
  const problem = negotiateProblem();
  const checks = [
    { key: "login", label: "«ورود با حساب سازمانی» روشن است", ok: conf.loginEnabled },
    { key: "approved", label: "منبع با دسترسی یک مدیر تأیید شده است", ok: !!conf.approvedBy },
    { key: "domains", label: "دامنه‌ها (NetBIOS و DNS) نوشته شده‌اند", ok: conf.domains.length > 0 },
    { key: "tls", label: "اتصال به کنترل‌کننده‌ها رمزنگاری‌شده است (LDAPS یا StartTLS)", ok: conf.tls === "ldaps" || conf.tls === "starttls" },
    { key: "host", label: "نام میزبان سامانه تعیین شده است", ok: !!String(src.sso_host ?? "").trim() },
    ...(conf.ssoMode === "negotiate"
      ? [
          { key: "account", label: "حساب سرویس سامانه برای SPN تعیین شده است", ok: !!account },
          { key: "negotiate", label: "ماژول Kerberos ویندوز روی این سرور آماده است", ok: !problem },
        ]
      : []),
    ...(conf.ssoMode === "proxy"
      ? [
          { key: "proxy_ips", label: "نشانی پراکسی‌های معتمد نوشته شده است", ok: conf.proxyIps.length > 0 },
          { key: "proxy_secret", label: "راز مشترک پراکسی ساخته شده است", ok: secret },
        ]
      : []),
  ];
  return {
    mode: conf.ssoMode,
    host,
    account,
    spn: spnCommands(host, account || "<حساب سرویس>"),
    negotiate: { available: !problem, problem },
    proxy: { header: conf.proxyHeader, ips: conf.proxyIps, secret, secret_header: "X-ITSM-Proxy-Secret" },
    checks,
  };
}

/** The source's latest sign-ins (the organisation's audit, filtered to it). */
export async function sourceSignins(ctx: Ctx, sourceId: string) {
  needIntegrations(ctx, "full");
  return ctx.db.query(
    `select e.id, e.at, e.ok, e.user_id, e.email, e.ip, e.data, u.full_name as user_name from sm_security_events e left join sm_users u on u.id = e.user_id
     where e.org_id = $1 and e.kind = 'sign_in' and e.data->>'source' = $2 order by e.at desc limit 200`,
    [ctx.org.id, sourceId],
  );
}
