// Sharing of definitions (catalogue ANA-013): a report's or dashboard's `shares` (and an indicator's
// `score_shares`) are compiled into row columns that the tables' row rules test — people, groups, units, unit
// subtrees, everyone, and the members holding a role. The condition language has no «my roles» operator, so role
// holders are resolved here from the organisation's access snapshot exactly as the access model composes a member's
// roles (profile and group roles, containment, the membership role of members without ITSM roles), and recomputed
// by the job `analytics.shares` whenever profiles, groups, memberships or roles change (and daily as a fallback).
import { compileShares, cleanShares, sharesProblem } from "@shared/analytics/share";
import type { CompiledShares, Share } from "@shared/analytics/types";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { bad } from "../../http/errors";
import { accessSettings, buildSubject, loadOrgSnapshot } from "../../access";
import { updateIn, onRecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { systemCtx } from "../../engine";
import { countRows, liveRows, sysOf, type Row } from "./common";

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

/** An indicator's score readers: the same compilation, kept in its `s_*` columns — and its owner, who defined it. */
export function scoreColumns(c: CompiledShares, ownerId?: string | null): { s_users: string[]; s_groups: string[]; s_all: boolean; s_roles: string[] } {
  const users = ownerId && UUID.test(ownerId) && !c.r_users.includes(ownerId.toLowerCase()) ? [...c.r_users, ownerId.toLowerCase()].sort() : c.r_users;
  return { s_users: users, s_groups: c.r_groups, s_all: c.r_all, s_roles: c.role_keys };
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
  const inds = await liveRows(sys.db, sys, "analytics_indicator", { f: "s_roles", op: "nempty" }, { limit: 5000 });
  for (const r of inds) {
    const { compiled } = await compileFor(sys.db, sys.org.id, r.score_shares ?? [], { check: false, holders });
    const cols = scoreColumns(compiled, r.owner_id);
    if (same(cols.s_users, r.s_users)) continue;
    await sys.write((tx) => restampIndicator(tx, sys, r, cols));
    changed++;
  }
  return changed;
}

/** New score readers on an indicator and every stored score of it (scores carry their own reader columns). */
export async function restampIndicator(q: Queryable, sys: Ctx, ind: Row, cols: ReturnType<typeof scoreColumns>): Promise<void> {
  await updateIn(q as never, sys, "analytics_indicator", ind.id, cols, { trusted: true, keepVersion: true });
  const scores = await liveRows(q, sys, "analytics_score", { f: "indicator_id", op: "eq", v: ind.id }, { limit: 20_000 });
  const next = { s_users: cols.s_users, s_groups: cols.s_groups, s_all: cols.s_all };
  for (const s of scores) {
    if (same(s.s_users, next.s_users) && same(s.s_groups, next.s_groups) && !!s.s_all === next.s_all) continue;
    await updateIn(q as never, sys, "analytics_score", s.id, next, { trusted: true, keepVersion: true });
  }
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
      // only organisations that share something with a role need it
      const sys = await systemCtx(jctx.cfg, e.org_id);
      const n =
        (await countRows(jctx.db, sys, "analytics_report", { f: "role_keys", op: "nempty" })) +
        (await countRows(jctx.db, sys, "analytics_dashboard", { f: "role_keys", op: "nempty" })) +
        (await countRows(jctx.db, sys, "analytics_indicator", { f: "s_roles", op: "nempty" }));
      if (n > 0) await queueShareRecompute(jctx.db, e.org_id);
    },
    { tables: ACCESS_TABLES },
  );
}

export { sysOf };
