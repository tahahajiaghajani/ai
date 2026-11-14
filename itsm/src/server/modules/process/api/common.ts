// Shared pieces of the user APIs (design F §5, §8.6, package F4c): the caller as the assignee rules see them (positions,
// groups, roles — `mine_expected` and «گردش‌کارهای من»), names of people, the case manager check, and the open-state
// constants. Reads only.
import { mayInclude, type PersonFacts, type StepAction } from "@shared/process/assignees";
import { formStepOf, outEdges, processNodeLabel, type ProcessGraph } from "@shared/process/graph";
import { grantIn } from "@shared/access";
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import { pgArray } from "../../../db";
import { prepareSubject, subjectOf } from "../../../access";
import { isSystemCtx } from "../../../engine";
import { heldPositions } from "../../positions";
import { myGroupsSql } from "../access/sources";
import { isId, peopleNames, type CaseRow } from "../engine/store";

export const OPEN_CASE = ["active", "waiting", "attention"];
export const CLOSED_CASE = ["completed", "rejected", "canceled"];

/** The caller as assignee rules see them (positions held today, groups, led groups, access roles). */
export async function personFacts(ctx: Ctx): Promise<PersonFacts> {
  const { subject } = await prepareSubject(ctx);
  const positions = (await heldPositions(ctx.db, ctx, ctx.user.id)).map((p) => ({ position: p.position, unit: p.unit }));
  return { user: ctx.user.id, positions, groups: subject.groups, leadGroups: subject.ledGroups, roles: subject.eff.roles };
}

/** Names of people by id, as a display map. */
export async function nameMap(q: Queryable, ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  return Object.fromEntries(await peopleNames(q, ids));
}

/** What a step asks of its people, as a person's part («تأییدکننده در "…"»). */
export function partOf(action: StepAction | string, label: string): string {
  const who = action === "approve" ? "تأییدکننده" : action === "review" ? "بررسی‌کننده" : "انجام‌دهنده";
  return `${who} در «${label}»`;
}

/** The steps of a graph whose rules may include the person (static: positions, groups, roles, named members). */
export function myStepKeys(graph: ProcessGraph, me: PersonFacts): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    if (n.type !== "form_step") continue;
    const s = formStepOf(n.config);
    if (s.start) continue;
    if (mayInclude(s, s.action, me)) out.push(n.id);
  }
  return out;
}

/** The label of the step a decision leads to when it is known (a form step or the end), else null. */
export function nextStepLabel(graph: ProcessGraph, node: string, port: string): string | null {
  let at = outEdges(graph, node, port)[0]?.target;
  for (let hops = 0; at && hops < 10; hops++) {
    const n = graph.nodes.find((x) => x.id === at);
    if (!n) return null;
    if (n.type === "form_step") return processNodeLabel(n);
    if (n.type === "end") return "پایان";
    if (n.type === "set_values" || n.type === "notify" || n.type === "wait_duration") {
      at = outEdges(graph, n.id, "out")[0]?.target;
      continue;
    }
    return null;
  }
  return null;
}

/** The organisation's administrators: owners and «مدیر» members, and holders of «مدیر سامانه». */
export async function orgAdmins(q: Queryable, orgId: string): Promise<string[]> {
  const rows = await q.query<{ user_id: string }>(
    `select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active and role in ('owner', 'admin')
     union select user_id from sm_member_profiles where org_id = $1 and deleted_at is null and roles ? 'tenant_admin'`,
    [orgId],
  );
  return rows.map((r) => String(r.user_id));
}

const hasManagers = (kase: Pick<CaseRow, "managers" | "manager_groups">): boolean => (kase.managers ?? []).some(isId) || (kase.manager_groups ?? []).some(isId);

/**
 * Does the caller manage the case: one of its managers (by name or a valid group membership), or — for a case that
 * names none — an administrator of the organisation (owner, «مدیر», or `process_design` approve). The same rule as
 * the recovery services (F4b).
 */
export async function managesCase(q: Queryable, ctx: Ctx, kase: Pick<CaseRow, "managers" | "manager_groups">): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  if (!hasManagers(kase)) {
    if (ctx.member?.role === "owner" || ctx.member?.role === "admin") return true;
    try {
      // inside the caller's transaction when it is one (PGlite has one connection)
      await prepareSubject(ctx, q);
      return grantIn(subjectOf(ctx).eff, "process_design").approve === true;
    } catch {
      return false;
    }
  }
  if ((kase.managers ?? []).includes(ctx.user.id)) return true;
  if (!(kase.manager_groups ?? []).length) return false;
  const r = await q.one<{ ok: boolean }>(`select coalesce($1::jsonb ?| ${myGroupsSql("$2::uuid")}, false) as ok`, [JSON.stringify(kase.manager_groups), ctx.user.id]);
  return r?.ok === true;
}

/** Group names by id (a display map). */
export async function groupNameMap(q: Queryable, orgId: string, ids: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter(isId))];
  if (!wanted.length) return {};
  const rows = await q.query<{ id: string; name: string }>(`select id, name from sm_groups where org_id = $1 and id = any($2::uuid[])`, [orgId, pgArray(wanted)]);
  return Object.fromEntries(rows.map((r) => [String(r.id), String(r.name)]));
}
