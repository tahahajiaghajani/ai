// Directory synchronisation (catalogue INT-013, ACC-077): what reading LDAP / Active Directory (or a SCIM push) would do
// to the organisation's members, units and groups — computed as a plan that the admin previews before anything is
// written («پیش‌نمایش» / dry run). Pure: the server reads the directory and the members, this file decides.
//
// Rules: members are matched by e-mail; only members this source created or linked are ever deactivated or removed
// from groups (manual members are left alone); roles are never granted silently — a new member gets the source's
// default role (shown in the plan), and roles mapped from directory groups are listed as role grants that an apply
// performs only when the admin confirms them (or opted into automatic roles on the source).
// Imported by the UI: keep it free of server imports.

export interface DirEntry {
  /** the directory's identity of the person (DN, objectGUID, a SCIM id) */
  external_id: string;
  email: string | null;
  name: string;
  username?: string | null;
  title?: string | null;
  phone?: string | null;
  department?: string | null;
  /** the manager's external id (an AD `manager` DN) */
  manager?: string | null;
  /** the directory groups (DNs or names) the person belongs to */
  groups: string[];
  active: boolean;
  /**
   * The directory object itself, whatever its name (AD objectGUID, OpenLDAP entryUUID): a link remembers it, so a new
   * person given a former employee's DN never opens that employee's account. Null when the directory has none.
   */
  object_id?: string | null;
  /** when the directory object was made (AD whenCreated / createTimestamp, ISO), when known */
  created_at?: string | null;
}

export interface CurrentMember {
  user_id: string;
  email: string;
  name: string;
  active: boolean;
  /** membership role (owner, admin, member, viewer) */
  role: string;
  /** explicit ITSM roles */
  roles: string[];
  title?: string | null;
  phone?: string | null;
  unit_id?: string | null;
  manager_id?: string | null;
  /** ITSM groups the member belongs to */
  groups: string[];
}

export interface GroupMapping {
  /** a directory group: its DN, its CN or its display name */
  source: string;
  /** the ITSM group its members join (null: only the role) */
  group_id: string | null;
  /** a role its members get — listed as a role grant, never applied silently */
  role?: string | null;
  /** the organisation unit its members belong to (a directory sign-in sets it; the first matching mapping wins) */
  unit_id?: string | null;
  /** a workspace its members join — a grant like a role: only once approved */
  workspace_id?: string | null;
}

/** What a person's directory groups map to: ITSM groups, roles (with the mapping that grants each), a unit, workspaces. */
export interface MappedAccess {
  groups: string[];
  roles: { role: string; source: string }[];
  unit_id: string | null;
  workspaces: string[];
}

/** Apply the mappings to a person's directory groups (DNs or names; nested groups already resolved). */
export function mappedAccess(mappings: GroupMapping[], groups: string[]): MappedAccess {
  const out: MappedAccess = { groups: [], roles: [], unit_id: null, workspaces: [] };
  for (const m of mappings) {
    if (!groups.some((g) => groupMatches(g, m.source))) continue;
    if (m.group_id && !out.groups.includes(m.group_id)) out.groups.push(m.group_id);
    if (m.role && !out.roles.some((r) => r.role === m.role)) out.roles.push({ role: m.role, source: m.source });
    if (m.unit_id && !out.unit_id) out.unit_id = m.unit_id;
    if (m.workspace_id && !out.workspaces.includes(m.workspace_id)) out.workspaces.push(m.workspace_id);
  }
  return out;
}

export interface DirOptions {
  /** the explicit ITSM role of new members (e.g. requester); null leaves them without one */
  default_role: string | null;
  deactivate_missing: boolean;
  /** «department»: units are matched (and missing ones created) by the department attribute */
  unit_from: "none" | "department";
  /** role grants of mapped groups are applied without a confirmation */
  auto_roles: boolean;
}

export interface PlanCreate {
  external_id: string;
  email: string;
  name: string;
  title: string | null;
  phone: string | null;
  unit: string | null;
  manager: string | null;
  roles: string[];
  groups: string[];
}

export interface PlanUpdate {
  user_id: string;
  external_id: string;
  email: string;
  name: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface PlanPerson {
  user_id: string;
  email: string;
  name: string;
  reason: string;
}

export interface PlanGroupChange {
  group_id: string;
  /** an existing member's id, or the e-mail of one created by the plan */
  user: string;
  email: string;
}

export interface PlanRoleGrant {
  user: string;
  email: string;
  role: string;
  /** the directory group that maps to it */
  source: string;
}

export interface DirPlan {
  create: PlanCreate[];
  update: PlanUpdate[];
  deactivate: PlanPerson[];
  reactivate: PlanPerson[];
  group_adds: PlanGroupChange[];
  group_removes: PlanGroupChange[];
  role_grants: PlanRoleGrant[];
  units: string[];
  links: { external_id: string; email: string; object_id?: string | null }[];
  skipped: { external_id: string; name: string; reason: string }[];
}

export const emptyPlan = (): DirPlan => ({ create: [], update: [], deactivate: [], reactivate: [], group_adds: [], group_removes: [], role_grants: [], units: [], links: [], skipped: [] });

/** Plan counts for the screens and the run log. */
export function planStats(p: DirPlan): Record<string, number> {
  return {
    create: p.create.length,
    update: p.update.length,
    deactivate: p.deactivate.length,
    reactivate: p.reactivate.length,
    group_adds: p.group_adds.length,
    group_removes: p.group_removes.length,
    role_grants: p.role_grants.length,
    units: p.units.length,
    skipped: p.skipped.length,
  };
}

const lower = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const RESERVED = /@(?:[^\s@]*\.)?invalid\.?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The CN of a DN («CN=IT Support,OU=Groups,DC=corp,DC=ir» → «IT Support»), or the text itself. */
export function cnOf(dn: string): string {
  const m = /^\s*cn=((?:\\,|[^,])+)/i.exec(dn);
  return m ? m[1].replace(/\\,/g, ",").trim() : dn.trim();
}

/**
 * A DN in one spelling (RFC 4514): attribute types and values compared case-insensitively, spaces around the
 * separators ignored, escapes («\,» and «\2C», «\D8\A7» and «ا») read the same.
 */
export function canonicalDn(dn: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const out: string[] = [];
  let bytes: number[] = [];
  let type = "";
  let inValue = false;
  const text = () => {
    const t = dec.decode(new Uint8Array(bytes)).trim().toLowerCase();
    bytes = [];
    return t;
  };
  for (let i = 0; i < dn.length; i++) {
    const ch = dn[i];
    if (ch === "\\" && i + 1 < dn.length) {
      const hex = dn.slice(i + 1, i + 3);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(...enc.encode(dn[i + 1]));
        i++;
      }
      continue;
    }
    if (!inValue && ch === "=") {
      type = text();
      inValue = true;
      continue;
    }
    if (ch === "," || ch === ";" || ch === "+") {
      out.push(`${type}=${text()}${ch === "+" ? "+" : ""}`);
      type = "";
      inValue = false;
      continue;
    }
    bytes.push(...enc.encode(ch));
  }
  out.push(`${type}=${text()}`);
  return out.join(",").replace(/\+,/g, "+");
}

/** Is a mapping's source a full DN (CN=…,OU=…), not a group's bare name? */
export const isFullDn = (source: string): boolean => /^\s*[a-z][a-z0-9-]*\s*=/i.test(source) && canonicalDn(source).includes(",");

/**
 * Does a directory group match a mapping's source? A full DN matches that very group only (Active Directory keeps a
 * CN unique only within its container: a look-alike «CN=Kariz-Admins» another OU's administrator makes never
 * matches); a bare name (or «CN=name») matches any group with that CN — the mapping screen says so.
 */
export function groupMatches(group: string, source: string): boolean {
  const s = source.trim();
  if (!s) return false;
  if (isFullDn(s)) return canonicalDn(group) === canonicalDn(s);
  const name = lower(cnOf(s));
  return lower(group) === lower(s) || lower(cnOf(group)) === name;
}

/**
 * The plan of a full synchronisation. `links` maps the source's external ids to member ids (people it created or
 * linked before); `units` are the organisation's units by name.
 */
export function planDirectorySync(input: {
  entries: DirEntry[];
  members: CurrentMember[];
  links: Record<string, string>;
  /** the directory objects the links remember (external id → objectGUID / entryUUID) */
  linkObjects?: Record<string, string | null>;
  mappings: GroupMapping[];
  units: { id: string; name: string }[];
  options: DirOptions;
  /** addresses no directory makes or changes (the platform's administrators) */
  reserved?: readonly string[];
}): DirPlan {
  const plan = emptyPlan();
  const { options } = input;
  const byEmail = new Map(input.members.map((m) => [lower(m.email), m]));
  const byId = new Map(input.members.map((m) => [m.user_id, m]));
  const linkedUsers = new Set(Object.values(input.links));
  const seenEmails = new Set<string>();
  const seenExternal = new Set<string>();
  const unitNames = new Map(input.units.map((u) => [lower(u.name), u.id]));
  const newUnits = new Set<string>();
  // the external id of every directory person, to resolve managers inside the batch
  const emailOfExternal = new Map(input.entries.map((e) => [lower(e.external_id), lower(e.email)]));

  const wantedGroups = (e: DirEntry) => {
    const groups = new Set<string>();
    const roles: { role: string; source: string }[] = [];
    for (const m of input.mappings) {
      if (!e.groups.some((g) => groupMatches(g, m.source))) continue;
      if (m.group_id) groups.add(m.group_id);
      if (m.role) roles.push({ role: m.role, source: m.source });
    }
    return { groups: [...groups], roles };
  };

  for (const e of input.entries) {
    const email = lower(e.email);
    seenExternal.add(e.external_id);
    if (!email || !EMAIL.test(email)) {
      plan.skipped.push({ external_id: e.external_id, name: e.name, reason: "ایمیل ندارد یا ایمیل معتبر نیست" });
      continue;
    }
    if (RESERVED.test(email)) {
      plan.skipped.push({ external_id: e.external_id, name: e.name, reason: "نشانی رزروشدهٔ حساب‌های خدمت است" });
      continue;
    }
    if ((input.reserved ?? []).some((r) => lower(r) === email)) {
      plan.skipped.push({ external_id: e.external_id, name: e.name, reason: "نشانی مدیر سامانه است و حساب آن را خودش می‌سازد" });
      continue;
    }
    if (seenEmails.has(email)) {
      plan.skipped.push({ external_id: e.external_id, name: e.name, reason: "ایمیل تکراری در فهرست کاربران" });
      continue;
    }
    seenEmails.add(email);
    const want = wantedGroups(e);
    const unit = options.unit_from === "department" && e.department?.trim() ? e.department.trim() : null;
    if (unit && !unitNames.has(lower(unit)) && !newUnits.has(lower(unit))) {
      newUnits.add(lower(unit));
      plan.units.push(unit);
    }
    const managerEmail = e.manager ? emailOfExternal.get(lower(e.manager)) ?? null : null;
    const current = byEmail.get(email);
    if (!current) {
      if (!e.active) {
        plan.skipped.push({ external_id: e.external_id, name: e.name, reason: "در فهرست کاربران غیرفعال است" });
        continue;
      }
      plan.create.push({
        external_id: e.external_id,
        email,
        name: e.name.trim() || email,
        title: e.title?.trim() || null,
        phone: e.phone?.trim() || null,
        unit,
        manager: managerEmail,
        roles: options.default_role ? [options.default_role] : [],
        groups: want.groups,
      });
      for (const g of want.groups) plan.group_adds.push({ group_id: g, user: email, email });
      for (const r of want.roles) if (r.role !== options.default_role) plan.role_grants.push({ user: email, email, role: r.role, source: r.source });
      plan.links.push({ external_id: e.external_id, email, object_id: e.object_id ?? null });
      continue;
    }
    // a link is (re)written when it is missing or names another member, and when it does not yet remember the object
    if (input.links[e.external_id] !== current.user_id || (e.object_id && (input.linkObjects?.[e.external_id] ?? null) !== e.object_id))
      plan.links.push({ external_id: e.external_id, email, object_id: e.object_id ?? null });
    const ours = linkedUsers.has(current.user_id) || input.links[e.external_id] === current.user_id;
    if (!e.active) {
      if (current.active && ours && current.role !== "owner" && current.role !== "admin") plan.deactivate.push({ user_id: current.user_id, email, name: current.name, reason: "در فهرست کاربران غیرفعال شده است" });
      continue;
    }
    if (!current.active && ours) plan.reactivate.push({ user_id: current.user_id, email, name: current.name, reason: "در فهرست کاربران دوباره فعال است" });
    const changes: PlanUpdate["changes"] = {};
    const name = e.name.trim();
    if (name && name !== current.name) changes.name = { from: current.name, to: name };
    if (e.title?.trim() && e.title.trim() !== (current.title ?? "")) changes.title = { from: current.title ?? null, to: e.title.trim() };
    if (e.phone?.trim() && e.phone.trim() !== (current.phone ?? "")) changes.phone = { from: current.phone ?? null, to: e.phone.trim() };
    if (unit) {
      const id = unitNames.get(lower(unit)) ?? null;
      if (id !== (current.unit_id ?? null)) changes.unit = { from: current.unit_id ?? null, to: unit };
    }
    if (managerEmail) {
      const mgr = byEmail.get(managerEmail);
      if (mgr && mgr.user_id !== current.user_id && mgr.user_id !== (current.manager_id ?? null)) changes.manager = { from: current.manager_id ?? null, to: managerEmail };
    }
    if (Object.keys(changes).length) plan.update.push({ user_id: current.user_id, external_id: e.external_id, email, name: current.name, changes });
    for (const g of want.groups) if (!current.groups.includes(g)) plan.group_adds.push({ group_id: g, user: current.user_id, email });
    for (const r of want.roles) if (!current.roles.includes(r.role)) plan.role_grants.push({ user: current.user_id, email, role: r.role, source: r.source });
    // mapped groups this source's member left in the directory
    if (ours) {
      const mapped = new Set(input.mappings.map((m) => m.group_id).filter((g): g is string => !!g));
      for (const g of current.groups) if (mapped.has(g) && !want.groups.includes(g)) plan.group_removes.push({ group_id: g, user: current.user_id, email });
    }
  }
  if (options.deactivate_missing) {
    for (const [ext, userId] of Object.entries(input.links)) {
      if (seenExternal.has(ext)) continue;
      const m = byId.get(userId);
      if (!m || !m.active || m.role === "owner" || m.role === "admin") continue;
      if (seenEmails.has(lower(m.email))) continue;
      plan.deactivate.push({ user_id: m.user_id, email: m.email, name: m.name, reason: "دیگر در فهرست کاربران نیست" });
    }
  }
  return plan;
}

/** The plan with role grants removed (an apply without the admin's confirmation of roles). */
export function withoutRoleGrants(p: DirPlan): DirPlan {
  return { ...p, role_grants: [] };
}

// ---------------------------------------------------------------- attribute mapping

/** Directory attribute names per person field (Active Directory defaults; editable per source). */
export interface AttrMap {
  email: string;
  name: string;
  username: string;
  title: string;
  phone: string;
  department: string;
  manager: string;
  groups: string;
  id: string;
  disabled: string;
}

export const AD_ATTRS: AttrMap = {
  email: "mail",
  name: "displayName",
  username: "sAMAccountName",
  title: "title",
  phone: "telephoneNumber",
  department: "department",
  manager: "manager",
  groups: "memberOf",
  id: "distinguishedName",
  disabled: "userAccountControl",
};

export function attrMapOf(raw: unknown): AttrMap {
  const out = { ...AD_ATTRS };
  if (raw && typeof raw === "object") for (const k of Object.keys(out) as (keyof AttrMap)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && /^[A-Za-z][A-Za-z0-9-;.]{0,60}$/.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

const first = (v: string[] | undefined) => (v && v.length ? v[0] : null);

/** LDAP GeneralizedTime («20261110083000.0Z») as ISO; null when it does not read. */
export function generalizedTime(v: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:[.,]\d+)?(Z|[+-]\d{4})?$/.exec(v.trim());
  if (!m) return null;
  const tz = !m[7] || m[7] === "Z" ? "Z" : `${m[7].slice(0, 3)}:${m[7].slice(3)}`;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${tz}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A directory entry from an LDAP search result (attribute names compared case-insensitively). */
export function entryFromLdap(dn: string, attrs: Record<string, string[]>, map: AttrMap): DirEntry {
  const get = (name: string) => {
    if (name.toLowerCase() === "distinguishedname" || name.toLowerCase() === "dn") return [dn];
    const k = Object.keys(attrs).find((x) => x.toLowerCase() === name.toLowerCase());
    return k ? attrs[k] : undefined;
  };
  const uac = Number(first(get(map.disabled)) ?? "0");
  // Active Directory: bit 2 of userAccountControl = the account is disabled
  const disabled = map.disabled.toLowerCase() === "useraccountcontrol" ? Number.isFinite(uac) && (uac & 2) === 2 : /^(true|1|yes|disabled)$/i.test(String(first(get(map.disabled)) ?? ""));
  const email = first(get(map.email)) ?? (/@/.test(first(get("userPrincipalName")) ?? "") ? first(get("userPrincipalName")) : null);
  const created = first(get("whenCreated")) ?? first(get("createTimestamp"));
  return {
    external_id: first(get(map.id)) ?? dn,
    object_id: first(get("objectGUID"))?.toLowerCase() ?? first(get("entryUUID"))?.toLowerCase() ?? null,
    created_at: created ? generalizedTime(created) : null,
    email: email ? email.trim().toLowerCase() : null,
    name: (first(get(map.name)) ?? first(get("cn")) ?? "").trim(),
    username: first(get(map.username)),
    title: first(get(map.title)),
    phone: first(get(map.phone)),
    department: first(get(map.department)),
    manager: first(get(map.manager)),
    groups: get(map.groups) ?? [],
    active: !disabled,
  };
}
