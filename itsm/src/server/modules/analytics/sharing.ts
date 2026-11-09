// Sharing of definitions (catalogue ANA-013): a report's or dashboard's `shares` (and an indicator's
// `score_shares`) are compiled into row columns that the tables' row rules test — people, groups, units, unit
// subtrees, everyone, and the members holding a role. The condition language has no «my roles» operator, so role
// holders are resolved here from the organisation's access snapshot exactly as the access model composes a member's
// roles (profile and group roles, containment, the membership role of members without ITSM roles), and recomputed
// by the job `analytics.shares` whenever profiles, groups, memberships or roles change (and daily as a fallback).
import { compileShares, cleanShares, sharesProblem } from "@shared/analytics/share";
import { grantIn } from "@shared/access/model";
import { tableDef } from "@shared/tables";
import type { CompiledShares, IndicatorPart, Share } from "@shared/analytics/types";
import type { FieldGroup } from "@shared/model/types";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { bad } from "../../http/errors";
import { accessSettings, buildSubject, loadOrgSnapshot } from "../../access";
import { updateIn, onRecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { systemCtx } from "../../engine";
import { liveRows, sysOf, type Row } from "./common";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Members holding each role (active members only), from one access snapshot. */
export async function roleHolders(q: Queryable, orgId: string): Promise<Map<string, string[]>> {
  const snap = await loadOrgSnapshot(q, orgId);
  const org = await q.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [orgId]);
  const settings = accessSettings({ settings: (org?.settings ?? {}) as never });
  const members = await q.query<{ user_id: string; role: string; overrides: Record<string, unknown> | null }>(
    `select user_id, role, overrides from sm_org_members where org_id = $1 and deleted_at is null and is_active`,
    [orgId],
  );
  const out = new Map<string, Set<string>>();
  for (const m of members) {
    const built = buildSubject(snap, settings, orgId, m.user_id, m.role as never, m.overrides);
    for (const r of built.subject.kind === "user" ? built.subject.eff.roles : []) (out.get(r) ?? out.set(r, new Set()).get(r)!).add(m.user_id);
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

/** Members who administer reports (the reports area's admin right; active members only), from one access snapshot. */
export async function reportAdmins(q: Queryable, orgId: string): Promise<Set<string>> {
  const snap = await loadOrgSnapshot(q, orgId);
  const org = await q.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [orgId]);
  const settings = accessSettings({ settings: (org?.settings ?? {}) as never });
  const members = await q.query<{ user_id: string; role: string; overrides: Record<string, unknown> | null }>(
    `select user_id, role, overrides from sm_org_members where org_id = $1 and deleted_at is null and is_active`,
    [orgId],
  );
  const out = new Set<string>();
  for (const m of members) {
    const built = buildSubject(snap, settings, orgId, m.user_id, m.role as never, m.overrides);
    if (built.subject.kind === "user" && grantIn(built.subject.eff, "reports").admin) out.add(m.user_id.toLowerCase());
  }
  return out;
}

/**
 * Does an indicator's owner read its stored scores? Stored scores are the whole organisation's numbers: only a report
 * administrator who owns an indicator reads them as its owner — anyone else only through `score_shares`, which report
 * administrators set.
 */
export async function ownerReadsScores(q: Queryable, orgId: string, ownerId: unknown, admins?: Set<string>): Promise<boolean> {
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return false;
  return (admins ?? (await reportAdmins(q, orgId))).has(ownerId.toLowerCase());
}

/** Check that every shared group, unit and person exists in the organisation (Persian refusal otherwise). */
async function checkTargets(q: Queryable, orgId: string, shares: Share[]): Promise<void> {
  const ids = (kind: Share["kind"][]) => [...new Set(shares.filter((s) => kind.includes(s.kind) && s.id && UUID.test(s.id)).map((s) => s.id!.toLowerCase()))];
  const groups = ids(["group"]);
  const units = ids(["unit", "unit_tree"]);
  const users = ids(["user"]);
  const count = async (sql: string, list: string[]) => (list.length ? Number((await q.one<{ n: number }>(sql, [orgId, `{${list.join(",")}}`]))?.n ?? 0) : 0);
  if (groups.length && (await count(`select count(*)::int as n from sm_groups where org_id = $1 and deleted_at is null and id = any($2::uuid[])`, groups)) !== groups.length) throw bad("گروهی که اشتراک با آن خواسته شده پیدا نشد");
  if (units.length && (await count(`select count(*)::int as n from sm_org_units where org_id = $1 and deleted_at is null and id = any($2::uuid[])`, units)) !== units.length) throw bad("واحدی که اشتراک با آن خواسته شده پیدا نشد");
  if (users.length && (await count(`select count(*)::int as n from sm_org_members where org_id = $1 and deleted_at is null and user_id = any($2::uuid[])`, users)) !== users.length) throw bad("کسی که اشتراک با او خواسته شده عضو این سازمان نیست");
}

/** Validate and compile a sharing list (refuses unknown targets). */
export async function compileFor(q: Queryable, orgId: string, input: unknown, opts: { check?: boolean; holders?: Map<string, string[]> } = {}): Promise<{ shares: Share[]; compiled: CompiledShares }> {
  const problem = sharesProblem(input);
  if (problem) throw bad(problem);
  const shares = cleanShares(input);
  if (opts.check !== false) await checkTargets(q, orgId, shares);
  const holders = shares.some((s) => s.kind === "role") ? (opts.holders ?? (await roleHolders(q, orgId))) : new Map<string, string[]>();
  return { shares, compiled: compileShares(shares, (r) => holders.get(r) ?? []) };
}

/**
 * An indicator's score readers: the same compilation, kept in its `s_*` columns — and its owner when the owner may read
 * organisation-wide scores (`ownerReads`: a report administrator, see ownerReadsScores).
 */
export function scoreColumns(c: CompiledShares, ownerId?: string | null, ownerReads = false): { s_users: string[]; s_groups: string[]; s_all: boolean; s_roles: string[] } {
  const users = ownerReads && ownerId && UUID.test(ownerId) && !c.r_users.includes(ownerId.toLowerCase()) ? [...c.r_users, ownerId.toLowerCase()].sort() : c.r_users;
  return { s_users: [...users].sort(), s_groups: [...c.r_groups].sort(), s_all: c.r_all, s_roles: c.role_keys };
}

/**
 * The field groups an indicator's numbers are made of (an amount in «مالی», a salary in «منابع انسانی»): every field
 * its parts measure, date, filter or break down by. Live values are computed with the viewer's access (a hidden field
 * refuses the part); stored scores are the organisation's — only members holding every one of these groups read them.
 */
export function scoreFieldGroups(parts: unknown, breakdowns?: unknown): FieldGroup[] {
  const out = new Set<FieldGroup>();
  const ps = Array.isArray(parts) ? (parts as IndicatorPart[]) : [];
  const fieldsOf = (c: unknown, acc: string[]): string[] => {
    if (!c || typeof c !== "object") return acc;
    if (Array.isArray(c)) {
      for (const x of c) fieldsOf(x, acc);
      return acc;
    }
    const o = c as Record<string, unknown>;
    if (typeof o.f === "string") acc.push(o.f);
    for (const k of ["and", "or", "not"]) if (o[k]) fieldsOf(o[k], acc);
    return acc;
  };
  for (const p of ps) {
    const def = p && typeof p.table === "string" ? tableDef(p.table) : undefined;
    if (!def) continue;
    const names = [p.field, p.from, p.date_field, ...fieldsOf(p.filter, []), ...(Array.isArray(breakdowns) ? (breakdowns as string[]) : [])];
    for (const n of names) {
      if (typeof n !== "string" || !n) continue;
      const g = def.fields.find((f) => f.name === n.split(".")[0])?.group;
      if (g) out.add(g);
    }
  }
  return [...out].sort();
}

/** Active members with their groups and field groups, from one access snapshot. */
export async function memberAccess(q: Queryable, orgId: string): Promise<{ user: string; groups: string[]; fieldGroups: string[] }[]> {
  const snap = await loadOrgSnapshot(q, orgId);
  const org = await q.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [orgId]);
  const settings = accessSettings({ settings: (org?.settings ?? {}) as never });
  const members = await q.query<{ user_id: string; role: string; overrides: Record<string, unknown> | null }>(
    `select user_id, role, overrides from sm_org_members where org_id = $1 and deleted_at is null and is_active`,
    [orgId],
  );
  return members.map((m) => {
    const s = buildSubject(snap, settings, orgId, m.user_id, m.role as never, m.overrides).subject;
    return { user: m.user_id.toLowerCase(), groups: s.kind === "user" ? s.groups.map((g) => g.toLowerCase()) : [], fieldGroups: s.kind === "user" ? [...s.eff.fieldGroups] : [] };
  });
}

/**
 * Score readers held to the indicator's field groups (`scoreFieldGroups`): with none, the columns as compiled; else
 * the members the columns name (everyone, a group, a person) who hold every required group — as people (groups and
 * «everyone» are expanded, so a member who later joins a group is added by the recomputation that follows it).
 */
export function gateScoreColumns<T extends { s_users: string[]; s_groups: string[]; s_all: boolean }>(cols: T, required: FieldGroup[], members: { user: string; groups: string[]; fieldGroups: string[] }[]): T {
  if (!required.length) return cols;
  const users = new Set(cols.s_users.map((u) => u.toLowerCase()));
  const groups = new Set(cols.s_groups.map((g) => g.toLowerCase()));
  const readers = members
    .filter((m) => required.every((g) => m.fieldGroups.includes(g)))
    .filter((m) => cols.s_all || users.has(m.user) || m.groups.some((g) => groups.has(g)))
    .map((m) => m.user)
    .sort();
  return { ...cols, s_users: readers, s_groups: [], s_all: false };
}

/** An indicator row's score columns: its compiled sharing, its owner when they read scores, the field-group gate. */
export async function indicatorScoreColumns(q: Queryable, orgId: string, ind: Row, c: CompiledShares, ownerReads: boolean, members?: Awaited<ReturnType<typeof memberAccess>>): Promise<ReturnType<typeof scoreColumns>> {
  const cols = scoreColumns(c, ind.owner_id, ownerReads);
  const required = scoreFieldGroups(ind.parts, ind.breakdowns);
  return required.length ? gateScoreColumns(cols, required, members ?? (await memberAccess(q, orgId))) : cols;
}

const same = (a: unknown, b: unknown) => JSON.stringify([...((a as string[]) ?? [])].sort()) === JSON.stringify([...((b as string[]) ?? [])].sort());

/**
 * Recompute the role-based columns of every shared definition and indicator of an organisation (roles, groups or
 * profiles changed). Only rows that share with a role are touched; their version is kept (no open form is stale).
 */
export async function recomputeRoleShares(sys: Ctx): Promise<number> {
  const holders = await roleHolders(sys.db, sys.org.id);
  let changed = 0;
  for (const table of ["analytics_report", "analytics_dashboard"]) {
    const rows = await liveRows(sys.db, sys, table, { f: "role_keys", op: "nempty" }, { limit: 5000 });
    for (const r of rows) {
      const { compiled } = await compileFor(sys.db, sys.org.id, r.shares ?? [], { check: false, holders });
      if (same(compiled.r_users, r.r_users) && same(compiled.w_users, r.w_users)) continue;
      await sys.write((tx) => updateIn(tx, sys, table, r.id, { r_users: compiled.r_users, w_users: compiled.w_users }, { trusted: true, keepVersion: true }));
      changed++;
    }
  }
  // every indicator: its role readers, and its owner only while the owner administers reports
  const admins = await reportAdmins(sys.db, sys.org.id);
  const inds = await liveRows(sys.db, sys, "analytics_indicator", null, { limit: 5000 });
  let members: Awaited<ReturnType<typeof memberAccess>> | undefined;
  for (const r of inds) {
    const { compiled } = await compileFor(sys.db, sys.org.id, r.score_shares ?? [], { check: false, holders });
    // indicators made of guarded fields (amounts…) name their readers one by one: who holds the field group changes
    if (scoreFieldGroups(r.parts, r.breakdowns).length) members ??= await memberAccess(sys.db, sys.org.id);
    const cols = await indicatorScoreColumns(sys.db, sys.org.id, r, compiled, admins.has(String(r.owner_id ?? "").toLowerCase()), members);
    if (same(cols.s_users, r.s_users) && same(cols.s_groups, r.s_groups) && !!cols.s_all === !!r.s_all) continue;
    await sys.write((tx) => restampIndicator(tx, sys, r, cols));
    changed++;
  }
  return changed;
}

/**
 * New score readers on an indicator and every stored score of it (scores carry their own reader columns): one
 * set-based statement over all its scores, however many (the sync trigger stamps each changed row as an update would).
 */
export async function restampIndicator(q: Queryable, sys: Ctx, ind: Row, cols: ReturnType<typeof scoreColumns>): Promise<void> {
  await updateIn(q as never, sys, "analytics_indicator", ind.id, cols, { trusted: true, keepVersion: true });
  const table = tableDef("analytics_score")!.table;
  const users = JSON.stringify(cols.s_users);
  const groups = JSON.stringify(cols.s_groups);
  await q.query(
    `update ${table} set s_users = $3::jsonb, s_groups = $4::jsonb, s_all = $5, updated_at = now()
      where org_id = $1 and indicator_id = $2 and deleted_at is null
        and (s_users is distinct from $3::jsonb or s_groups is distinct from $4::jsonb or s_all is distinct from $5)`,
    [sys.org.id, ind.id, users, groups, !!cols.s_all],
  );
}

const ACCESS_TABLES = ["member_profile", "group_member", "group", "role"];

/** Queue a recomputation shortly after access changes (deduplicated per organisation). */
export async function queueShareRecompute(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "analytics.shares", orgId, delayMs: 5_000, dedupeKey: "analytics.shares", maxAttempts: 5 });
}

export function installSharingJobs(): void {
  registerJobHandler("analytics.shares", async (job, jctx: JobContext) => {
    if (!job.org_id) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    await recomputeRoleShares(sys);
  });
  onRecordEvent(
    "analytics.roles",
    async (e, jctx) => {
      if (!e.org_id) return;
      // one deduplicated, slightly delayed job per burst of access changes; the job itself finds whether anything
      // shares with a role (nothing to do in most organisations) — no queries per event
      await queueShareRecompute(jctx.db, e.org_id);
    },
    { tables: ACCESS_TABLES },
  );
}

export { sysOf };
