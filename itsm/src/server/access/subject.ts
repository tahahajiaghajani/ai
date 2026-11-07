// Who is asking: the subject the access model evaluates every row and field for (docs/spec/ACCESS.md § Subject).
// Built once per request from an organisation-wide snapshot of the access tables (roles, units, groups, workspaces,
// profiles, group memberships) and the caller's membership row. Both are cached in memory and revalidated once per
// request with one small query — the organisation's access version (bumped by triggers on every change to the
// access tables, whichever path wrote it: API, sync push or pull) and the member's scope epoch — so a revocation
// is effective on the next request on every instance.
import type { Ctx, OrgRow } from "../context";
import { isOutsider, supportPermissions } from "../context";
import type { Queryable } from "../db";
import type { CondEnv } from "@shared/model/conditions";
import { permissionMap, type Role as MembershipRole } from "@shared/permissions";
import {
  composeEffective, roleCatalog, NO_GRANT, type DeskPreset, type Effective, type RoleDef, type Subject,
} from "@shared/access";

export interface AccessSettings {
  /** records carry the domain (company) of their requester; members see their domain subtree unless a role says all */
  domainSeparation: boolean;
  /** the service-desk preset of the built-in agent roles */
  preset: DeskPreset;
}

export function accessSettings(org: Pick<OrgRow, "settings">): AccessSettings {
  const a = (org.settings?.access ?? {}) as Record<string, unknown>;
  return { domainSeparation: a.domain_separation === true, preset: a.preset === "need_to_know" ? "need_to_know" : "open" };
}

// ----- the organisation snapshot ------------------------------------------------------------------------------

interface UnitRow { id: string; parent_id: string | null; path: string | null; manager_id: string | null; is_domain: boolean; active: boolean }
interface GroupRow { id: string; parent_id: string | null; restricted: boolean; active: boolean; roles: string[] | null; workspace_id: string | null }
interface WorkspaceRow { id: string; secure: boolean; active: boolean }
export interface ProfileRow {
  user_id: string;
  org_unit_id: string | null;
  manager_id: string | null;
  delegate_id: string | null;
  out_of_office: boolean;
  ooo_until: string | null;
  domain_unit_id: string | null;
  roles: string[] | null;
  workspaces: string[] | null;
  persona: string | null;
}
interface MembershipRow { group_id: string; user_id: string; kind: string; valid_from: string | null; valid_to: string | null }

export interface Snapshot {
  version: number;
  roles: RoleDef[];
  units: Map<string, UnitRow>;
  groups: Map<string, GroupRow>;
  workspaces: Map<string, WorkspaceRow>;
  profiles: Map<string, ProfileRow>;
  memberships: MembershipRow[];
  /** group id → child group ids */
  children: Map<string, string[]>;
}

const snapshots = new Map<string, Snapshot>();
const MAX_ORGS = 500;

async function versionOf(q: Queryable, orgId: string, userId: string | null): Promise<{ version: number; epoch: number }> {
  const r = await q.one<{ v: string | null; e: number | null }>(
    `select (select version from sm_access_state where org_id = $1)::text as v,
            (select epoch from sm_scope_epochs where org_id = $1 and user_id = $2) as e`,
    [orgId, userId],
  );
  return { version: Number(r?.v ?? 0), epoch: Number(r?.e ?? 0) };
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Load the organisation's access tables (not cached when read inside a transaction: it may roll back). */
async function loadSnapshot(q: Queryable, orgId: string, version: number): Promise<Snapshot> {
  const [roles, units, groups, workspaces, profiles, memberships] = await Promise.all([
    q.query<RoleDef & { active: boolean }>(
      `select key, name, description, persona, grants, field_groups, contains, workspaces, domains, active from sm_roles where org_id = $1 and deleted_at is null`,
      [orgId],
    ),
    q.query<UnitRow>(`select id, parent_id, path, manager_id, is_domain, active from sm_org_units where org_id = $1 and deleted_at is null`, [orgId]),
    q.query<GroupRow>(`select id, parent_id, restricted, active, roles, workspace_id from sm_groups where org_id = $1 and deleted_at is null`, [orgId]),
    q.query<WorkspaceRow>(`select id, secure, active from sm_workspaces where org_id = $1 and deleted_at is null`, [orgId]),
    q.query<ProfileRow>(
      `select user_id, org_unit_id, manager_id, delegate_id, out_of_office, ooo_until, domain_unit_id, roles, workspaces, persona
       from sm_member_profiles where org_id = $1 and deleted_at is null`,
      [orgId],
    ),
    q.query<MembershipRow>(`select group_id, user_id, kind, valid_from, valid_to from sm_group_members where org_id = $1 and deleted_at is null`, [orgId]),
  ]);
  const children = new Map<string, string[]>();
  for (const g of groups) if (g.parent_id) children.set(g.parent_id, [...(children.get(g.parent_id) ?? []), g.id]);
  return {
    version,
    roles: roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description ?? undefined,
      persona: r.persona,
      grants: r.grants && typeof r.grants === "object" ? r.grants : {},
      field_groups: arr(r.field_groups) as RoleDef["field_groups"],
      contains: arr(r.contains),
      workspaces: r.workspaces === "all" ? "all" : "member",
      domains: r.domains === "all" ? "all" : "own",
      active: r.active !== false,
    })),
    units: new Map(units.map((u) => [u.id, u])),
    groups: new Map(groups.map((g) => [g.id, { ...g, roles: arr(g.roles) }])),
    workspaces: new Map(workspaces.map((w) => [w.id, w])),
    profiles: new Map(profiles.map((p) => [p.user_id, { ...p, roles: arr(p.roles), workspaces: arr(p.workspaces) }])),
    memberships,
    children,
  };
}

async function snapshotOf(q: Queryable, orgId: string, version: number): Promise<Snapshot> {
  const hit = snapshots.get(orgId);
  if (hit && hit.version === version) return hit;
  const snap = await loadSnapshot(q, orgId, version);
  if (!(q as { inTx?: boolean }).inTx) {
    snapshots.delete(orgId);
    snapshots.set(orgId, snap);
    if (snapshots.size > MAX_ORGS) snapshots.delete(snapshots.keys().next().value!);
  }
  return snap;
}

/** The organisation's role catalogue (built-ins under its preset, replaced or extended by its own rows). */
export function catalogOf(snap: Snapshot, settings: AccessSettings): Map<string, RoleDef> {
  return roleCatalog(snap.roles, settings.preset);
}

// ----- subjects -----------------------------------------------------------------------------------------------

const active = (m: MembershipRow, now: number) =>
  (!m.valid_from || Date.parse(m.valid_from) <= now) && (!m.valid_to || Date.parse(m.valid_to) > now);

/** The units of `rootIds` and every unit below them (materialised paths). */
function subtree(snap: Snapshot, rootIds: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  const roots = rootIds.filter((id): id is string => !!id && snap.units.has(id));
  if (!roots.length) return [];
  const prefixes = roots.map((id) => snap.units.get(id)!.path ?? `/${id}/`);
  for (const u of snap.units.values()) {
    const p = u.path ?? `/${u.id}/`;
    if (prefixes.some((x) => p.startsWith(x))) out.add(u.id);
  }
  for (const r of roots) out.add(r);
  return [...out].sort();
}

/** The groups below `ids` (not including them). */
function groupDescendants(snap: Snapshot, ids: string[]): string[] {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    for (const c of snap.children.get(stack.pop()!) ?? []) {
      if (out.has(c) || ids.includes(c)) continue;
      out.add(c);
      stack.push(c);
    }
  }
  return [...out];
}

/** The domain of a member: their explicit one, else the nearest unit at or above theirs flagged as a domain. */
export function domainOfUnit(snap: Snapshot, unitId: string | null | undefined): string | null {
  if (!unitId) return null;
  const u = snap.units.get(unitId);
  if (!u) return null;
  const chain = (u.path ?? `/${u.id}/`).split("/").filter(Boolean).reverse();
  for (const id of chain) if (snap.units.get(id)?.is_domain) return id;
  return null;
}

export function memberDomain(snap: Snapshot, profile: ProfileRow | undefined): string | null {
  if (!profile) return null;
  if (profile.domain_unit_id && snap.units.has(profile.domain_unit_id)) return profile.domain_unit_id;
  return domainOfUnit(snap, profile.org_unit_id);
}

export interface Built {
  subject: Subject;
  env: Omit<CondEnv, "tz" | "now" | "prev"> & { domainId: string | null };
  /** recompute after this instant (a membership or an absence starts or ends) */
  until: number;
}

const SUBJECT_TTL = 5 * 60_000;

/** A member's subject from the snapshot (pure: tests build subjects for random organisations with it). */
export function buildSubject(snap: Snapshot, settings: AccessSettings, orgId: string, userId: string, role: MembershipRole, overrides: Record<string, unknown> | null, now = Date.now()): Built {
  let until = now + SUBJECT_TTL;
  const edge = (t: string | null | undefined) => {
    const ms = t ? Date.parse(t) : NaN;
    if (Number.isFinite(ms) && ms > now && ms < until) until = ms;
  };
  const catalog = catalogOf(snap, settings);
  const profile = snap.profiles.get(userId);
  const mine = snap.memberships.filter((m) => {
    if (m.user_id !== userId) return false;
    edge(m.valid_from);
    edge(m.valid_to);
    const g = snap.groups.get(m.group_id);
    return !!g && g.active !== false && active(m, now);
  });
  const direct = mine.map((m) => m.group_id);
  const led = mine.filter((m) => m.kind === "lead").map((m) => m.group_id);
  const below = groupDescendants(snap, led);
  const groups = [...new Set([...direct, ...below])].sort();
  const writeGroups = [...new Set([...mine.filter((m) => m.kind !== "observer").map((m) => m.group_id), ...below])].sort();
  const explicit = new Set<string>(profile?.roles ?? []);
  for (const m of mine) if (m.kind !== "observer") for (const r of snap.groups.get(m.group_id)?.roles ?? []) explicit.add(r);
  const eff = composeEffective({ role, levels: permissionMap(role, overrides as never), explicit: [...explicit], catalog });
  const unitId = profile?.org_unit_id && snap.units.has(profile.org_unit_id) ? profile.org_unit_id : null;
  const unitTree = subtree(snap, [unitId]);
  const managed = [...snap.units.values()].filter((u) => u.manager_id === userId).map((u) => u.id);
  const managedTree = subtree(snap, managed);
  const profiles = [...snap.profiles.values()];
  const level1 = profiles.filter((p) => p.manager_id === userId && p.user_id !== userId).map((p) => p.user_id);
  const level2 = profiles.filter((p) => p.manager_id && level1.includes(p.manager_id) && p.user_id !== userId).map((p) => p.user_id);
  const reportees = [...new Set([...level1, ...level2])].sort();
  const delegators = profiles
    .filter((p) => {
      if (p.delegate_id !== userId || !p.out_of_office || p.user_id === userId) return false;
      edge(p.ooo_until);
      return !p.ooo_until || Date.parse(p.ooo_until) > now;
    })
    .map((p) => p.user_id)
    .sort();
  const domainId = memberDomain(snap, profile);
  const domainTree = subtree(snap, [domainId]);
  const workspaces = new Set<string>(profile?.workspaces ?? []);
  for (const id of direct) {
    const w = snap.groups.get(id)?.workspace_id;
    if (w) workspaces.add(w);
  }
  const secureWorkspaces = [...snap.workspaces.values()].filter((w) => w.secure).map((w) => w.id).sort();
  const restrictedGroups = [...snap.groups.values()].filter((g) => g.restricted && g.active !== false).map((g) => g.id).sort();
  const subject: Subject = {
    orgId,
    userId,
    kind: "user",
    eff,
    groups,
    writeGroups,
    ledGroups: led.sort(),
    unitId,
    unitTree,
    managedTree,
    reportees,
    delegators,
    domainSeparation: settings.domainSeparation,
    domainId,
    domainTree,
    workspaces: [...workspaces].sort(),
    secureWorkspaces,
    restrictedGroups,
  };
  const directSet = new Set(direct);
  const groupUsers = new Set<string>([userId]);
  for (const m of snap.memberships) if (directSet.has(m.group_id) && active(m, now)) groupUsers.add(m.user_id);
  const treeSet = new Set(unitTree);
  const env = {
    userId,
    groups,
    groupUsers: [...groupUsers].sort(),
    unitId,
    unitTree,
    unitUsers: unitId ? profiles.filter((p) => p.org_unit_id === unitId).map((p) => p.user_id).sort() : [],
    unitTreeUsers: profiles.filter((p) => p.org_unit_id && treeSet.has(p.org_unit_id)).map((p) => p.user_id).sort(),
    domainId,
  };
  return { subject, env, until };
}

const EMPTY_EFF: Effective = { roles: [], grants: { "*": { ...NO_GRANT } }, fieldGroups: [], workspacesAll: false, domainsAll: false, legacy: false };

function bare(orgId: string, userId: string, kind: Subject["kind"], eff: Effective, settings: AccessSettings): Subject {
  return {
    orgId, userId, kind, eff, groups: [], writeGroups: [], ledGroups: [], unitId: null, unitTree: [], managedTree: [], reportees: [],
    delegators: [], domainSeparation: settings.domainSeparation, domainId: null, domainTree: [], workspaces: [], secureWorkspaces: [], restrictedGroups: [],
  };
}

const subjects = new Map<string, Built & { key: string }>();
const MAX_SUBJECTS = 5000;
const prepared = new WeakMap<Ctx, Built>();
const pending = new WeakMap<Ctx, Promise<Built>>();

/** Load (or reuse) the caller's subject through `q`; memoised on the request's context. */
export function prepareSubject(ctx: Ctx, q: Queryable = ctx.db): Promise<Built> {
  const done = prepared.get(ctx);
  if (done) return Promise.resolve(done);
  let p = pending.get(ctx);
  if (!p) {
    p = build(ctx, q).then((b) => {
      prepared.set(ctx, b);
      return b;
    });
    pending.set(ctx, p);
    p.catch(() => pending.delete(ctx));
  }
  return p;
}

async function build(ctx: Ctx, q: Queryable): Promise<Built> {
  const settings = accessSettings(ctx.org);
  const orgId = ctx.org.id;
  if (ctx.actor === "system") return { subject: bare(orgId, ctx.user.id, "system", EMPTY_EFF, settings), env: { userId: ctx.user.id, domainId: null }, until: Infinity };
  if (isOutsider(ctx.member) && !ctx.support) return { subject: bare(orgId, ctx.user.id, "user", EMPTY_EFF, settings), env: { userId: ctx.user.id, groups: [], groupUsers: [ctx.user.id], unitId: null, unitTree: [], unitUsers: [], unitTreeUsers: [], domainId: null }, until: Infinity };
  const { version, epoch } = await versionOf(q, orgId, ctx.support ? null : ctx.user.id);
  const snap = await snapshotOf(q, orgId, version);
  ctxSnapshots.set(ctx, snap);
  if (ctx.actor === "support" && ctx.support) {
    const eff = composeEffective({ role: null, levels: supportPermissions(ctx.support.level), explicit: [], catalog: catalogOf(snap, settings), support: ctx.support.level });
    // a support session is nobody's member: secure workspaces and restricted groups stay closed to it
    const subject = bare(orgId, ctx.user.id, "support", eff, settings);
    subject.secureWorkspaces = [...snap.workspaces.values()].filter((w) => w.secure).map((w) => w.id).sort();
    subject.restrictedGroups = [...snap.groups.values()].filter((g) => g.restricted && g.active !== false).map((g) => g.id).sort();
    return { subject, env: { userId: ctx.user.id, groups: [], groupUsers: [ctx.user.id], unitId: null, unitTree: [], unitUsers: [], unitTreeUsers: [], domainId: null }, until: Infinity };
  }
  const key = `${version}:${epoch}:${settings.domainSeparation}:${settings.preset}:${ctx.member.role}:${JSON.stringify(ctx.member.overrides ?? {})}`;
  const id = `${orgId}:${ctx.user.id}`;
  const hit = subjects.get(id);
  if (hit && hit.key === key && Date.now() < hit.until) return hit;
  const built = buildSubject(snap, settings, orgId, ctx.user.id, ctx.member.role, ctx.member.overrides ?? null);
  if (!(q as { inTx?: boolean }).inTx) {
    subjects.delete(id);
    subjects.set(id, { ...built, key });
    if (subjects.size > MAX_SUBJECTS) subjects.delete(subjects.keys().next().value!);
  }
  return built;
}

/** The caller's subject; the engine prepared it before asking (`orgSchema`). System contexts need no preparation. */
export function subjectOf(ctx: Ctx): Subject {
  const b = prepared.get(ctx);
  if (b) return b.subject;
  if (ctx.actor === "system") return bare(ctx.org.id, ctx.user.id, "system", EMPTY_EFF, accessSettings(ctx.org));
  throw new Error("access subject not loaded: await prepareSubject(ctx) (the engine does it in orgSchema) before asking the access provider");
}

export function preparedOf(ctx: Ctx): Built | undefined {
  return prepared.get(ctx);
}

const ctxSnapshots = new WeakMap<Ctx, Snapshot>();

/**
 * The organisation snapshot behind the caller's subject (hooks, admin tools, the access checker): the one the
 * request's subject was built from, else the current one read through `q`.
 */
export async function snapshotFor(ctx: Ctx, q: Queryable = ctx.db, fresh = false): Promise<Snapshot> {
  const hit = fresh ? undefined : ctxSnapshots.get(ctx);
  if (hit) return hit;
  const { version } = await versionOf(q, ctx.org.id, null);
  return snapshotOf(q, ctx.org.id, version);
}

/** Read an organisation's access tables afresh (tools and tests; requests use the cached `snapshotFor`). */
export async function loadOrgSnapshot(q: Queryable, orgId: string): Promise<Snapshot> {
  const { version } = await versionOf(q, orgId, null);
  return loadSnapshot(q, orgId, version);
}

/** Forget cached snapshots and subjects (tests). */
export function clearAccessCaches(): void {
  snapshots.clear();
  subjects.clear();
}
