// Who a rule's notification goes to: the people its recipients spec names on the record (assignee, requester,
// watchers, user/group fields), fixed people, groups and roles, managers, the on-call person of the group (a hook the
// on-call module fills) and the people the event names (mentions, approvers). Resolved as the system — the access
// check comes per person when the message is rendered under their own context (deliver.ts): whoever cannot read the
// record, or the journal entry, gets nothing.
import type { TableDef } from "@shared/model/types";
import { scopeColumns } from "@shared/access";
import { groupAudience, type GroupNotifyMode, type RecipientSpec, type RuleGroupMode } from "@shared/notify";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { isUuid, systemRows } from "./common";

/** An on-call source: who is on call now for a group (the on-call module registers one). */
export type OnCallSource = (q: Queryable, orgId: string, groupId: string, at: Date) => Promise<string[]>;
const oncallSources: OnCallSource[] = [];

/** Add who is on call for a group (`oncall` recipients). Returns an unregister function. */
export function registerOnCallSource(fn: OnCallSource): () => void {
  oncallSources.push(fn);
  return () => {
    const i = oncallSources.indexOf(fn);
    if (i >= 0) oncallSources.splice(i, 1);
  };
}

/** At most this many people per rule and event (a group the size of the organisation is a configuration mistake). */
export const MAX_RECIPIENTS = 500;

export interface ResolveInput {
  sys: Ctx;
  def: TableDef;
  /** the record as the event left it */
  row: Record<string, unknown>;
  spec: RecipientSpec;
  /** people a journal entry mentions */
  mentioned?: string[];
  /** people the event names (`data.users`, `data.approvers`, `data.recipients`) */
  eventUsers?: string[];
  /** the rule's say over large groups (default: as each group decides) */
  groupMode?: RuleGroupMode;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]).map(String).filter(isUuid).map((x) => x.toLowerCase());

/** People of the record's user fields (`users` fields hold several). */
function fieldUsers(def: TableDef, row: Record<string, unknown>, names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const f = def.fields.find((x) => x.name === n);
    if (f && (f.type === "user" || f.type === "users")) out.push(...ids(row[n]));
  }
  return out;
}

/** The requester side: requested_for and caller_id; who opened the record only when nobody else is named. */
export function requesterUsers(def: TableDef, row: Record<string, unknown>): string[] {
  const names = scopeColumns(def).requester.map((c) => c.name);
  const main = names.filter((n) => n !== "opened_by");
  const found = fieldUsers(def, row, main);
  return found.length ? found : fieldUsers(def, row, names);
}

export const assigneeUsers = (def: TableDef, row: Record<string, unknown>) => fieldUsers(def, row, scopeColumns(def).assignee.map((c) => c.name));

/** Group memberships in force now. */
const VALID_NOW = `(t.valid_from is null or t.valid_from <= now()) and (t.valid_to is null or t.valid_to > now())`;

/** Members (and leads and observers) of groups, within their validity. */
export async function groupMembers(sys: Ctx, groups: string[], q: Queryable = sys.db): Promise<string[]> {
  const g = [...new Set(groups.filter(isUuid))];
  if (!g.length) return [];
  const rows = await systemRows<{ user_id: string }>(
    sys,
    "group_member",
    `t.group_id = any($1::uuid[]) and ${VALID_NOW}`,
    [pgArray(g)],
    "",
    q,
  );
  return rows.map((r) => String(r.user_id));
}

/**
 * The people of groups a rule's notification reaches. Every current member (members, leads, observers) — or, for a
 * group whose audience is «leads» (`groupAudience`: larger than LARGE_GROUP under «خودکار», or as the group or the rule
 * says), only its leads and its manager: the others see the record in the group's queue and its count instead of one
 * bell each. Two queries for any number of groups.
 */
export async function groupRecipients(sys: Ctx, groups: string[], rule: RuleGroupMode = "group"): Promise<string[]> {
  const g = [...new Set(groups.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!g.length) return [];
  const [defs, members] = await Promise.all([
    systemRows<{ id: string; notify_mode: GroupNotifyMode | null; manager_id: string | null }>(sys, "group", "t.id = any($1::uuid[])", [pgArray(g)]),
    systemRows<{ group_id: string; user_id: string; kind: string | null }>(sys, "group_member", `t.group_id = any($1::uuid[]) and ${VALID_NOW}`, [pgArray(g)]),
  ]);
  const byGroup = new Map<string, { user: string; kind: string | null }[]>();
  for (const m of members) {
    const k = String(m.group_id).toLowerCase();
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push({ user: String(m.user_id), kind: m.kind ?? null });
  }
  const out: string[] = [];
  for (const d of defs) {
    const list = byGroup.get(String(d.id).toLowerCase()) ?? [];
    if (groupAudience(rule, d.notify_mode, list.length) === "members") out.push(...list.map((m) => m.user));
    else {
      out.push(...list.filter((m) => m.kind === "lead").map((m) => m.user));
      if (d.manager_id) out.push(String(d.manager_id));
    }
  }
  return out;
}

async function managersOf(sys: Ctx, users: string[]): Promise<string[]> {
  const u = [...new Set(users.filter(isUuid))];
  if (!u.length) return [];
  const rows = await systemRows<{ manager_id: string | null }>(sys, "member_profile", "t.user_id = any($1::uuid[]) and t.manager_id is not null", [pgArray(u)]);
  return rows.map((r) => String(r.manager_id));
}

async function groupManagers(sys: Ctx, groups: string[]): Promise<string[]> {
  const g = [...new Set(groups.filter(isUuid))];
  if (!g.length) return [];
  const rows = await systemRows<{ manager_id: string | null }>(sys, "group", "t.id = any($1::uuid[]) and t.manager_id is not null", [pgArray(g)]);
  return rows.map((r) => String(r.manager_id));
}

/** Members holding a role: on their profile, through a group's roles, and (tenant_admin) owners and «مدیر» members. */
async function roleHolders(sys: Ctx, roles: string[]): Promise<string[]> {
  if (!roles.length) return [];
  const out: string[] = [];
  const keys = JSON.stringify(roles);
  const profiles = await systemRows<{ user_id: string }>(sys, "member_profile", "t.roles ?| (select array_agg(x) from jsonb_array_elements_text($1::jsonb) x)", [keys]);
  out.push(...profiles.map((r) => String(r.user_id)));
  const groups = await systemRows<{ id: string }>(sys, "group", "t.roles ?| (select array_agg(x) from jsonb_array_elements_text($1::jsonb) x)", [keys]);
  out.push(...(await groupMembers(sys, groups.map((g) => String(g.id)))));
  if (roles.includes("tenant_admin")) {
    const admins = await sys.db.query<{ user_id: string }>(
      `select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active and role in ('owner', 'admin')`,
      [sys.org.id],
    );
    out.push(...admins.map((r) => String(r.user_id)));
  }
  return out;
}

/**
 * The people a rule names for a record, each with why (`assignee`, `watchers`, `group:<id>`…; the reasons decide the
 * inbox tab). Deduplicated; who acted is removed by the caller unless the rule asks otherwise.
 */
export async function resolveRecipients(x: ResolveInput): Promise<Map<string, Set<string>>> {
  const { sys, def, row, spec } = x;
  const out = new Map<string, Set<string>>();
  const add = (users: string[], reason: string) => {
    for (const u of users) {
      if (!isUuid(u)) continue;
      const id = u.toLowerCase();
      if (!out.has(id)) out.set(id, new Set());
      out.get(id)!.add(reason);
    }
  };
  const sc = scopeColumns(def);
  const group = sc.group ? ids(row[sc.group])[0] ?? null : null;
  const assignees = assigneeUsers(def, row);
  const requesters = requesterUsers(def, row);
  if (spec.assignee) add(assignees, "assignee");
  if (spec.requester) add(requesters, "requester");
  if (spec.watchers && sc.watchers) add(ids(row[sc.watchers]), "watchers");
  const mode = x.groupMode ?? "group";
  if (spec.assignment_group && group) add(await groupRecipients(sys, [group], mode), "assignment_group");
  if (spec.group_manager && group) add(await groupManagers(sys, [group]), "group_manager");
  if (spec.assignee_manager) add(await managersOf(sys, assignees), "assignee_manager");
  if (spec.requester_manager) add(await managersOf(sys, requesters), "requester_manager");
  if (spec.oncall && group) for (const src of oncallSources) add(await src(sys.db, sys.org.id, group, new Date()).catch(() => []), "oncall");
  if (spec.mentioned) add(x.mentioned ?? [], "mentioned");
  if (spec.event_users) add(x.eventUsers ?? [], "event_users");
  if (spec.fields?.length) {
    add(fieldUsers(def, row, spec.fields), "fields");
    const groupFields = spec.fields.filter((n) => def.fields.find((f) => f.name === n)?.type === "group");
    const gs = groupFields.flatMap((n) => ids(row[n]));
    if (gs.length) add(await groupRecipients(sys, gs, mode), "fields");
  }
  if (spec.users?.length) add(spec.users, "users");
  if (spec.groups?.length) add(await groupRecipients(sys, spec.groups, mode), "groups");
  if (spec.roles?.length) add(await roleHolders(sys, spec.roles), "roles");
  return out;
}

/** People an event names in its data (approvers of an approval request, the people an SLA escalates to…). */
export function eventUsersOf(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  return [...new Set([...ids(data.users), ...ids(data.approvers), ...ids(data.recipients), ...ids(data.user_id), ...ids(data.approver_id)])];
}
