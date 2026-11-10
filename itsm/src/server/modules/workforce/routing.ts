// Skills-based routing and the skills picture (WFM-002/007/009/038):
//   · `suggestAssignees`: for a record, the members of its team ranked by skill match (the skills its category,
//     subcategory, service and title point to through the catalogue's keywords, and the team's skill needs) ×
//     availability (presence, shift, time off) × spare capacity, with the reasons in Persian — a suggestion, never an
//     assignment. The platform's assignment rules route by the same skills through the member profiles the module
//     keeps in step (hooks.ts).
//   · `experts`: people with a skill at a level (the expert finder for swarming)
//   · `inferSkills`: skills suggested to a person from the work they resolved — kept apart from verified skills and
//     shown only to the person until they accept them
//   · `coverageReport`: each skill need of a team or service against the people who meet it; single points of
//     knowledge and gaps
import { normalizeSearch } from "@shared/model/conditions";
import { countingSkills, rankCandidates, routingScore, skillMatch, type RoutingCandidate } from "@shared/workforce/logic";
import { proficiencyLabel } from "@shared/tables/workforce";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { condEnv, createIn, emitEvent, get, orgSchema, readable } from "../../engine";
import { forbidden } from "../../http/errors";
import { grantIn } from "@shared/access";
import { prepareSubject, subjectOf } from "../../access";
import { groupsOfUser, isUuid, liveRow, liveRows, membersOf, msOf, myGroups, namesOf, overseenGroups, sysOf, todayOf, workforceConfig, type Row } from "./common";
import { openByUser, workTables } from "./capacity";
import { shiftNow } from "./schedule";

const words = (s: unknown) => normalizeSearch(String(s ?? "")).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/** Skills a record points to (catalogue keywords against its category, subcategory, service and title). */
export async function skillsForRecord(q: Queryable, ctx: Ctx, rec: Row, groupId: string | null): Promise<{ skill_id: string; level: number; why: string }[]> {
  const sys = sysOf(ctx);
  const catalogue = await liveRows(q, sys, "wfm_skill", { and: [{ f: "active", op: "eq", v: true }, { f: "routing", op: "eq", v: true }] }, { limit: 2000 });
  const service = isUuid(rec.service_id) ? (await liveRow(q, sys, "service", rec.service_id))?.name : null;
  const signals = new Set([...words(rec.category), ...words(rec.subcategory), ...words(service), ...words(rec.short_description)]);
  const out = new Map<string, { skill_id: string; level: number; why: string }>();
  for (const s of catalogue) {
    const keys = (Array.isArray(s.keywords) ? s.keywords : []).flatMap((k: string) => words(k));
    const hit = keys.find((k: string) => signals.has(k));
    if (hit) out.set(String(s.id), { skill_id: String(s.id), level: 2, why: `«${s.name}» از «${hit}»` });
  }
  if (groupId) {
    for (const c of await liveRows(q, sys, "wfm_coverage", { f: "group_id", op: "eq", v: groupId }, { limit: 200 })) {
      if (!out.has(String(c.skill_id))) out.set(String(c.skill_id), { skill_id: String(c.skill_id), level: Number(c.min_level ?? 2), why: "نیاز مهارتی تیم" });
    }
  }
  return [...out.values()].slice(0, 8);
}

export interface Suggestion {
  required: { skill_id: string; name: string; level: number; why: string }[];
  candidates: (RoutingCandidate & { name: string })[];
  group_id: string | null;
}

/** Ranked people of the record's team for a person who may change the record (WFM-009). */
export async function suggestAssignees(ctx: Ctx, table: string, id: string): Promise<Suggestion> {
  const r = await get(ctx, table, id);
  if (!r.meta.canWrite) throw forbidden("پیشنهاد کارشناس برای کسانی است که این رکورد را تغییر می‌دهند");
  const sys = sysOf(ctx);
  const def = (await orgSchema(ctx)).def(table);
  const groupField = def?.scope.group ?? "assignment_group_id";
  const rec = (await liveRow(ctx.db, sys, table, id))!;
  const groupId = isUuid(rec[groupField]) ? String(rec[groupField]) : null;
  const cfg = await workforceConfig(ctx.db, sys);
  const required = await skillsForRecord(ctx.db, sys, rec, groupId);
  const people = groupId ? (await membersOf(ctx.db, sys, [groupId])).get(groupId) ?? [] : [];
  if (!people.length) return { required: [], candidates: [], group_id: groupId };
  const skills = await liveRows(ctx.db, sys, "wfm_person_skill", { f: "user_id", op: "in", v: people }, { limit: 10_000 });
  const today = todayOf(ctx);
  const agents = await liveRows(ctx.db, sys, "wfm_agent", { f: "user_id", op: "in", v: people });
  const profiles = await liveRows(ctx.db, sys, "member_profile", { f: "user_id", op: "in", v: people });
  const caps = await liveRows(ctx.db, sys, "wfm_capacity", { f: "group_id", op: "eq", v: groupId! });
  const groupCap = caps.find((c) => !isUuid(c.user_id));
  const open = await openByUser(ctx.db, sys, people);
  const names = await namesOf(ctx.db, ctx.org.id, people);
  const now = Date.now();
  const candidates: (RoutingCandidate & { name: string })[] = [];
  for (const u of people) {
    // the organisation's routing rule: the least level, and verified skills only when it asks for them
    const mine = countingSkills(skills.filter((s) => s.user_id === u).map((s) => ({ skill_id: String(s.skill_id), level: Number(s.level ?? 0), verified: !!s.verified, status: s.status, expires_at: s.expires_at })), today, { minLevel: cfg.routing_min_level, needsVerified: cfg.routing_needs_verified });
    const m = skillMatch(required.map((x) => ({ skill_id: x.skill_id, level: x.level })), mine);
    const agent = agents.find((a) => a.user_id === u);
    const profile = profiles.find((p) => p.user_id === u);
    const away = !!profile?.out_of_office && (!profile.ooo_until || (msOf(profile.ooo_until) ?? 0) > now);
    const shift = await shiftNow(ctx.db, sys, u, now);
    const limit = Number(caps.find((c) => c.user_id === u)?.max_open ?? agent?.wip_limit ?? groupCap?.max_open ?? 8);
    const presence = agent?.presence ?? null;
    const c = routingScore({ user_id: u, match: m.match, presence, on_shift: shift.on, shift_left_minutes: shift.left, absent: away, open: open.get(u) ?? 0, limit }, cfg.shift_end_guard_minutes);
    candidates.push({ ...c, name: names.get(u) ?? "" });
  }
  const skillRows = required.length ? await liveRows(ctx.db, sys, "wfm_skill", { f: "id", op: "in", v: required.map((x) => x.skill_id) }) : [];
  return {
    required: required.map((x) => ({ ...x, name: String(skillRows.find((s) => s.id === x.skill_id)?.name ?? "") })),
    candidates: rankCandidates(candidates) as (RoutingCandidate & { name: string })[],
    group_id: groupId,
  };
}

/**
 * People with a skill at a level or above (counting skills only). A finder of people: only for callers who read the
 * users directory (not external roles such as a vendor's agents); live presence only of the caller's own and
 * overseen teams' people (like a team's board).
 */
export async function experts(ctx: Ctx, skillId: string, minLevel = 3): Promise<{ user_id: string; name: string; level: number; level_label: string; verified: boolean; presence: string | null }[]> {
  const sys = sysOf(ctx);
  await prepareSubject(ctx, ctx.db);
  if (grantIn(subjectOf(ctx).eff, "users").read === "none") throw forbidden("یافتن کارشناس برای کسانی است که فهرست اعضای سازمان را می‌بینند");
  const over = await overseenGroups(ctx.db, ctx);
  const near = new Set([...(await myGroups(ctx.db, ctx)), ...over.groups]);
  const rows = await liveRows(ctx.db, sys, "wfm_person_skill", { and: [{ f: "skill_id", op: "eq", v: skillId }, { f: "level", op: "gte", v: minLevel }] }, { order: "t.level desc", limit: 200 });
  const today = todayOf(ctx);
  const counting = rows.filter((r) => (r.status ?? "active") === "active" && (!r.expires_at || String(r.expires_at) >= today));
  const people = counting.map((r) => String(r.user_id));
  const names = await namesOf(ctx.db, ctx.org.id, people);
  const agents = people.length ? await liveRows(ctx.db, sys, "wfm_agent", { f: "user_id", op: "in", v: people }) : [];
  const seen = new Map<string, boolean>();
  for (const u of new Set(people)) seen.set(u, over.all || u === ctx.user.id || (await groupsOfUser(ctx.db, sys, u)).some((g) => near.has(g)));
  return counting.map((r) => ({
    user_id: String(r.user_id), name: names.get(String(r.user_id)) ?? "", level: Number(r.level), level_label: proficiencyLabel(r.level), verified: !!r.verified,
    presence: seen.get(String(r.user_id)) ? (agents.find((a) => a.user_id === r.user_id)?.presence ?? null) : null,
  }));
}

/** Suggest skills to a person from the work they resolved in the last 180 days (as suggestions they accept). */
export async function inferSkills(ctx: Ctx, userId: string, opts: { minRecords?: number } = {}): Promise<{ suggested: { skill_id: string; name: string; records: number; level: number }[] }> {
  const sys = sysOf(ctx);
  const min = opts.minRecords ?? 3;
  const catalogue = await liveRows(ctx.db, sys, "wfm_skill", { f: "active", op: "eq", v: true }, { limit: 2000 });
  const keyed = catalogue.map((s) => ({ s, keys: new Set((Array.isArray(s.keywords) ? s.keywords : []).flatMap((k: string) => words(k))) })).filter((x) => x.keys.size);
  if (!keyed.length) return { suggested: [] };
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const schema = await orgSchema(sys);
  const env = await condEnv(sys);
  const hits = new Map<string, number>();
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    if (!def.fields.some((f) => f.name === "resolved_at")) continue;
    const cols = ["category", "subcategory", "short_description"].filter((c) => def.fields.some((f) => f.name === c));
    if (!cols.length) continue;
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    params.push(userId, since);
    const rows = await ctx.db.query<Row>(`select ${cols.map((c) => `t.${c}`).join(", ")} from ${def.table} t where ${where} and t.deleted_at is null and t.assigned_to = $${params.length - 1}::uuid and t.resolved_at >= $${params.length}::timestamptz limit 2000`, params);
    for (const r of rows) {
      const ws = new Set(cols.flatMap((c) => words(r[c])));
      for (const { s, keys } of keyed) if ([...keys].some((k) => ws.has(k))) hits.set(String(s.id), (hits.get(String(s.id)) ?? 0) + 1);
    }
  }
  const have = new Set((await liveRows(ctx.db, sys, "wfm_person_skill", { f: "user_id", op: "eq", v: userId }, { limit: 2000 })).map((p) => String(p.skill_id)));
  const out: { skill_id: string; name: string; records: number; level: number }[] = [];
  await sys.write(async (tx) => {
    for (const [skillId, n] of [...hits.entries()].sort((a, b) => b[1] - a[1])) {
      if (n < min || have.has(skillId)) continue;
      const s = catalogue.find((x) => x.id === skillId)!;
      const level = n >= 25 ? 4 : n >= 10 ? 3 : 2;
      await createIn(tx, sys, "wfm_person_skill", { user_id: userId, skill_id: skillId, level, source: "inferred", status: "suggested", evidence: `${n} کار حل‌شده در شش ماه گذشته به این مهارت مربوط است` }, { trusted: true });
      out.push({ skill_id: skillId, name: String(s.name), records: n, level });
    }
    if (out.length) await emitEvent(tx, sys, { kind: "record.wfm.skills_suggested", table: "wfm_person_skill", id: userId, data: { users: [userId], skills: out.map((x) => x.name) } });
  });
  return { suggested: out };
}

export interface CoverageRow {
  id: string;
  label: string;
  group_id: string | null;
  skill_id: string;
  skill: string;
  min_level: number;
  min_people: number;
  critical: boolean;
  qualified: { user_id: string; name: string; level: number }[];
  gap: number;
  single_point: boolean;
}

/** Skill needs of teams (all, or the caller's overseen and own teams) against the people who meet them. */
export async function coverageReport(ctx: Ctx, opts: { group?: string | null } = {}): Promise<CoverageRow[]> {
  const sys = sysOf(ctx);
  const filter = opts.group ? { f: "group_id", op: "eq", v: opts.group } : null;
  // the needs the caller may read (their teams' through the participant source, every team's for managers)
  const needs = await liveRows(ctx.db, ctx, "wfm_coverage", filter as never, { limit: 1000 });
  const groups = [...new Set(needs.map((c) => String(c.group_id)).filter(isUuid))];
  const members = await membersOf(ctx.db, sys, groups);
  const allPeople = [...new Set([...members.values()].flat())];
  const skills = allPeople.length ? await liveRows(ctx.db, sys, "wfm_person_skill", { f: "user_id", op: "in", v: allPeople }, { limit: 20_000 }) : [];
  const names = await namesOf(ctx.db, ctx.org.id, allPeople);
  const catalogue = await liveRows(ctx.db, sys, "wfm_skill", { f: "id", op: "in", v: [...new Set(needs.map((c) => String(c.skill_id)))].filter(isUuid) });
  const today = todayOf(ctx);
  return needs.map((c) => {
    const ms = isUuid(c.group_id) ? members.get(String(c.group_id)) ?? [] : allPeople;
    const qualified = skills
      .filter((s) => ms.includes(String(s.user_id)) && s.skill_id === c.skill_id && Number(s.level ?? 0) >= Number(c.min_level ?? 1) && (s.status ?? "active") === "active" && (!s.expires_at || String(s.expires_at) >= today))
      .map((s) => ({ user_id: String(s.user_id), name: names.get(String(s.user_id)) ?? "", level: Number(s.level) }));
    const minPeople = Number(c.min_people ?? 1);
    return {
      id: String(c.id), label: String(c.label ?? ""), group_id: c.group_id ?? null, skill_id: String(c.skill_id), skill: String(catalogue.find((s) => s.id === c.skill_id)?.name ?? ""),
      min_level: Number(c.min_level ?? 1), min_people: minPeople, critical: !!c.critical, qualified, gap: Math.max(0, minPeople - qualified.length), single_point: qualified.length === 1,
    };
  });
}

export { pgArray };
