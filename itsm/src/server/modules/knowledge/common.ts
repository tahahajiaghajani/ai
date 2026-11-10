// Helpers of the knowledge module: the settings row, who the caller is in knowledge (grants, field groups, groups,
// contributor of a base), unit sub-trees for audiences, and system reads of bases, categories and articles. Every read
// of engine tables goes through `readable` (the shared helpers of the incident module), so with a member's context the
// same helpers return only what that member may read.
import { grantIn } from "@shared/access/model";
import { KB_CONFIG_DEFAULTS, DEFAULT_AQI_ITEMS, type AqiItem, type KbConfig } from "@shared/tables/knowledge";
import type { Ctx } from "../../context";
import { pgArray, type Queryable } from "../../db";
import { access } from "../../access/provider";
import { subjectOf } from "../../access";
import { condEnv, fromDb, orgSchema, orgTz, readable, toSql } from "../../engine";
import type { Cond } from "@shared/model/conditions";
import { todayISO } from "@shared/jalali";
import { liveRow, liveRows, sysOf, isUuid, type Row } from "../incident/common";

export { sysOf, liveRow, liveRows, isUuid, type Row };
export { countRows, eqAll, faList } from "../incident/common";

/** Live rows of `table` with these ids that the context may read (and that match `where`). */
export async function rowsById(q: Queryable, ctx: Ctx, table: string, idList: unknown[], where: Cond | null = null): Promise<Row[]> {
  const list = ids(idList);
  if (!list.length) return [];
  const schema = await orgSchema(ctx, q);
  const def = schema.def(table);
  if (!def || def.virtual) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env)];
  params.push(pgArray(list));
  parts.push(`t.id = any($${params.length}::uuid[])`);
  if (where) parts.push(toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
  const rows = await q.query<Row>(`select t.* from ${def.table} t where ${parts.join(" and ")}`, params);
  return rows.map((r) => fromDb(def, r));
}

export const uniq = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined && x !== ("" as unknown as T)))];
export const ids = (v: unknown): string[] => (Array.isArray(v) ? uniq(v.map((x) => (typeof x === "string" ? x.toLowerCase() : null))).filter(isUuid) : []);

/** The organisation's knowledge settings (its row, else the defaults). */
export async function kbConfig(q: Queryable, ctx: Ctx): Promise<KbConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "kb_config", null, { order: "t.created_at", limit: 1 });
  const out: Record<string, unknown> = { ...KB_CONFIG_DEFAULTS };
  if (row) for (const k of Object.keys(KB_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  const items = Array.isArray(row?.aqi_items) && row!.aqi_items.length ? (row!.aqi_items as AqiItem[]).filter((i) => i && i.key && Number(i.weight) >= 0) : DEFAULT_AQI_ITEMS;
  return { ...(out as typeof KB_CONFIG_DEFAULTS), default_group_id: row?.default_group_id ?? null, aqi_items: items, id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** The caller's grant in `knowledge` (the system holds everything). */
export function kbGrant(ctx: Ctx) {
  if (ctx.actor === "system") return { read: "all", write: "all", delete: "all", create: true, approve: true, admin: true } as const;
  return grantIn(subjectOf(ctx).eff, "knowledge");
}

/** May administer knowledge (bases, templates, rules, licences): the `admin` flag in `knowledge`, or the system. */
export const isKbAdmin = (ctx: Ctx): boolean => ctx.actor === "system" || !!kbGrant(ctx).admin;
/** May approve in `knowledge` (republish, retire without approval). */
export const isKbApprover = (ctx: Ctx): boolean => ctx.actor === "system" || !!kbGrant(ctx).approve;
/** Writes every article it can read (knowledge managers). */
export const writesAll = (ctx: Ctx): boolean => ctx.actor === "system" || kbGrant(ctx).write === "all";
/** Attachments a text names: images `![…](attachment:<id>)` and links `[…](attachment:<id>)`. */
export const attachmentRefs = (md: unknown): string[] => [...String(md ?? "").matchAll(/attachment:([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase());

/** May write knowledge at all (drafts, versions). */
export const canAuthor = (ctx: Ctx): boolean => ctx.actor === "system" || !!kbGrant(ctx).create;

/** Holds the `internal` field group (agents): sees internal sections and «فقط کارشناسان» content. */
export function holdsInternal(ctx: Ctx): boolean {
  if (ctx.actor === "system") return true;
  return access().hasFieldGroup(ctx, "internal");
}

/** The groups whose records the caller reads (members, leads, observers). */
export function myGroups(ctx: Ctx): string[] {
  if (ctx.actor === "system") return [];
  return subjectOf(ctx).groups;
}

/** Requester or agent, for the event stream and AI personas. */
export const personaOf = (ctx: Ctx): "agent" | "requester" => (holdsInternal(ctx) ? "agent" : "requester");

const hasAny = (list: unknown, set: string[]) => Array.isArray(list) && list.some((x) => set.includes(String(x)));

/**
 * May the caller write content in this base (new articles, new versions)? The system and knowledge managers always;
 * never someone «هرگز ننویسند»; base contributors (owner, managers, approvers, named contributors); in a base open to
 * every author, every member with the create grant in knowledge.
 */
export function contributesTo(ctx: Ctx, base: Row | null, extra: { category?: Row | null; article?: Row | null } = {}): boolean {
  if (ctx.actor === "system") return true;
  if (!base) return false;
  const me = ctx.user.id;
  const groups = myGroups(ctx);
  if ((base.nocontrib_users ?? []).includes(me) || hasAny(base.nocontrib_groups, groups)) return false;
  if (writesAll(ctx)) return true;
  if (!canAuthor(ctx)) return false;
  if ((base.k_users ?? []).includes(me) || hasAny(base.k_groups, groups)) return true;
  if (hasAny(extra.category?.m_groups, groups)) return true;
  const a = extra.article;
  if (a && (a.author_id === me || a.owner_id === me || (a.owner_group_id && groups.includes(a.owner_group_id)))) return true;
  return base.contrib_mode !== "named";
}

/** May the caller manage the base itself (its categories, settings): admins, its owner and its managers. */
export function managesBase(ctx: Ctx, base: Row | null): boolean {
  if (ctx.actor === "system" || isKbAdmin(ctx)) return true;
  if (!base) return false;
  return base.owner_id === ctx.user.id || (!!base.manager_group_id && myGroups(ctx).includes(base.manager_group_id));
}

/** A base, category or article as stored (the system reads the whole organisation). */
export const baseOf = (q: Queryable, ctx: Ctx, id: unknown) => liveRow(q, sysOf(ctx), "kb_base", id);
export const categoryOf = (q: Queryable, ctx: Ctx, id: unknown) => liveRow(q, sysOf(ctx), "kb_category", id);
export const articleOf = (q: Queryable, ctx: Ctx, id: unknown) => liveRow(q, sysOf(ctx), "kb_article", id);

/** Units with every unit below them (when `tree`), for audiences («واحدها با زیرمجموعه‌ها»). */
export async function expandUnits(q: Queryable, ctx: Ctx, units: unknown, tree: boolean): Promise<string[]> {
  const list = ids(units);
  if (!list.length || !tree) return list;
  const rows = await liveRows(q, sysOf(ctx), "org_unit", { or: list.map((id) => ({ f: "path", op: "contains" as const, v: `/${id}/` })) }, { limit: 5000 });
  return uniq([...list, ...rows.map((r) => String(r.id))]);
}

/** Members of groups (members and leads, valid now). */
export async function groupMembers(q: Queryable, ctx: Ctx, groups: unknown): Promise<string[]> {
  const list = ids(groups);
  if (!list.length) return [];
  const now = Date.now();
  const rows = await liveRows(q, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "in", v: list }, { f: "kind", op: "in", v: ["member", "lead"] }] }, { limit: 5000 });
  return uniq(
    rows
      .filter((r) => (!r.valid_from || Date.parse(r.valid_from) <= now) && (!r.valid_to || Date.parse(r.valid_to) > now))
      .map((r) => String(r.user_id)),
  );
}

/** Members whose profile places them in one of `units` (exact units). */
export async function unitMembers(q: Queryable, ctx: Ctx, units: string[]): Promise<string[]> {
  if (!units.length) return [];
  const rows = await liveRows(q, sysOf(ctx), "member_profile", { f: "org_unit_id", op: "in", v: units }, { limit: 10_000 });
  return uniq(rows.map((r) => String(r.user_id)));
}

/** Active members of the organisation among `users`. */
export async function activeMembers(q: Queryable, orgId: string, users: string[]): Promise<Set<string>> {
  const list = uniq(users).filter(isUuid);
  if (!list.length) return new Set();
  const rows = await q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [orgId, pgArray(list)]);
  return new Set(rows.map((r) => r.user_id));
}

/** Display names of members (for scrubbing captured text). */
export async function memberNames(q: Queryable, orgId: string, users: string[]): Promise<string[]> {
  const list = uniq(users).filter(isUuid);
  if (!list.length) return [];
  const rows = await q.query<{ full_name: string | null }>(
    `select u.full_name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = any($2::uuid[])`,
    [orgId, pgArray(list)],
  );
  return rows.map((r) => r.full_name ?? "").filter((n) => n.length >= 3);
}

/** The table definitions the caller's organisation uses (custom fields included). */
export async function defOf(ctx: Ctx, table: string, q?: Queryable) {
  const schema = await orgSchema(ctx, q);
  return schema.def(table);
}

/** Today in the organisation's zone, as an ISO date. */
export const todayIn = (ctx: Ctx): string => todayISO(orgTz(ctx));

export const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
