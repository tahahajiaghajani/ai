// Agent and team performance (WFM-034) with privacy first (WFM-041): numbers come from the work already recorded —
// records resolved, time to resolve, timers met, reassignments, reopens, first-contact resolution, satisfied
// requesters, knowledge published, points — computed by code. Who sees what:
//   · everyone sees their own scorecard, and the coaching notes written for them alone (the AI skill reads only
//     their own numbers; nobody else can ask for them)
//   · a team's numbers go to its members and those who oversee it, and only for teams of at least the organisation's
//     minimum size (no one's numbers can be read off a two-person team)
//   · another person's individual numbers need the «hr» field group AND oversight of one of that person's teams (or
//     the workforce manager's reach) — team leads without «hr» see the team, never the individuals
import { periodOf, type Period } from "@shared/slm/logic";
import { coachingNotes, teamLargeEnough, type AgentMetrics } from "@shared/workforce/logic";
import { tableDef } from "@shared/tables";
import { addUnits } from "@shared/model/jalali-buckets";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { condEnv, orgSchema, readable } from "../../engine";
import { forbidden } from "../../http/errors";
import { defineSkill, registerSkill } from "../ai/skills/registry";
import { runSkill } from "../ai/skills/runtime";
import type { SkillDef } from "../ai/skills/types";
import { answersWithoutAi } from "../slm/ai";
import { windowOf } from "../slm/measure";
import { experienceResponses } from "../slm/experience";
import { groupsOfUser, holdsFieldGroup, liveRows, managesWorkforce, membersOf, msOf, myGroups, namesOf, overseenGroups, sysOf, todayOf, workforceConfig, type Row } from "./common";
import { workTables } from "./capacity";

export type PeriodKey = "month" | "last_month" | "quarter";

export function periodFor(ctx: Ctx, key: PeriodKey = "month"): Period {
  const today = todayOf(ctx);
  if (key === "quarter") return periodOf(today, "quarter");
  const cur = periodOf(today, "month");
  return key === "last_month" ? periodOf(addUnits(cur.start, "month", -1), "month") : cur;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
};
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

interface Resolved {
  table: string;
  id: string;
  user: string | null;
  hours: number | null;
  reassigned: boolean;
  reopened: boolean;
}

/** Records resolved in a period by a person or a team, across every work table (as the system). */
async function resolvedIn(q: Queryable, ctx: Ctx, who: { user?: string; group?: string }, from: string, to: string): Promise<Resolved[]> {
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  const out: Resolved[] = [];
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    if (!def.fields.some((f) => f.name === "resolved_at")) continue;
    const opened = def.fields.some((f) => f.name === "opened_at") ? "coalesce(t.opened_at, t.created_at)" : "t.created_at";
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    params.push(from, to);
    let scope: string;
    if (who.user) {
      params.push(who.user);
      scope = `t.assigned_to = $${params.length}::uuid`;
    } else {
      params.push(who.group);
      scope = `t.assignment_group_id = $${params.length}::uuid`;
    }
    const rows = await q.query<{ id: string; u: string | null; h: number | null; ra: number | null; ro: number | null }>(
      `select t.id, t.assigned_to as u, extract(epoch from (t.resolved_at - ${opened})) / 3600 as h, t.reassignment_count as ra, t.reopen_count as ro from ${def.table} t
        where ${where} and t.deleted_at is null and t.resolved_at >= $${params.length - 2}::timestamptz and t.resolved_at < $${params.length - 1}::timestamptz and ${scope} limit 20000`,
      params,
    );
    for (const r of rows) out.push({ table: t.key, id: r.id, user: r.u, hours: r.h === null ? null : Number(r.h), reassigned: Number(r.ra ?? 0) > 0, reopened: Number(r.ro ?? 0) > 0 });
  }
  return out;
}

/** Records (ids per table) with a breached timer. */
async function breachedSet(q: Queryable, ctx: Ctx, rows: Resolved[]): Promise<{ timed: Set<string>; breached: Set<string> }> {
  const timed = new Set<string>();
  const breached = new Set<string>();
  if (!rows.length) return { timed, breached };
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("task_sla")!;
  const params: unknown[] = [];
  const where = readable(sys, def, "t", params, await condEnv(sys));
  params.push(pgArray(rows.map((r) => r.id)));
  const timers = await q.query<{ record_id: string; b: boolean }>(`select t.record_id, bool_or(t.breached) as b from ${def.table} t where ${where} and t.deleted_at is null and t.record_id = any($${params.length}::text[]) group by t.record_id`, params);
  for (const t of timers) {
    timed.add(t.record_id);
    if (t.b) breached.add(t.record_id);
  }
  return { timed, breached };
}

/** The scorecard of a set of resolved records (+ the open work and the other measures). */
async function scorecard(q: Queryable, ctx: Ctx, rows: Resolved[], extra: { open: number; knowledge: number; points: number; period: string; from: string; to: string }): Promise<AgentMetrics> {
  const { timed, breached } = await breachedSet(q, ctx, rows);
  const timedRows = rows.filter((r) => timed.has(r.id));
  let csatN = 0;
  let csatGood = 0;
  if (rows.length && tableDef("survey_response")) {
    const byTable = new Map<string, string[]>();
    for (const r of rows) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.id]);
    for (const [table, ids] of byTable) {
      const { responses } = await experienceResponses(q, ctx, { table_key: table, record_ids: ids.slice(0, 500), from: "1970-01-01T00:00:00Z", to: "2999-01-01T00:00:00Z" });
      for (const r of responses) if (r.csat !== null && r.csat !== undefined) {
        csatN++;
        if (Number(r.csat) >= 4) csatGood++;
      }
    }
  }
  return {
    period: extra.period,
    resolved: rows.length,
    open: extra.open,
    median_resolve_hours: median(rows.map((r) => r.hours).filter((h): h is number => h !== null && h >= 0)),
    within_sla_pct: pct(timedRows.filter((r) => !breached.has(r.id)).length, timedRows.length),
    reassigned_pct: pct(rows.filter((r) => r.reassigned).length, rows.length),
    reopened_pct: pct(rows.filter((r) => r.reopened).length, rows.length),
    first_contact_pct: pct(rows.filter((r) => !r.reassigned && !r.reopened).length, rows.length),
    csat_pct: csatN ? pct(csatGood, csatN) : null,
    csat_n: csatN,
    knowledge: extra.knowledge,
    points: extra.points,
  };
}

/** Open work assigned to people or a team now. */
async function openNow(q: Queryable, ctx: Ctx, who: { users?: string[]; group?: string }): Promise<Map<string, number> & { total?: number }> {
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const env = await condEnv(sys);
  const out = new Map<string, number>() as Map<string, number> & { total?: number };
  let total = 0;
  for (const t of workTables()) {
    const def = schema.def(t.key) ?? t;
    const params: unknown[] = [];
    const where = readable(sys, def, "t", params, env);
    let scope: string;
    if (who.users) {
      params.push(pgArray(who.users));
      scope = `t.assigned_to = any($${params.length}::uuid[])`;
    } else {
      params.push(who.group);
      scope = `t.assignment_group_id = $${params.length}::uuid`;
    }
    const rows = await q.query<{ u: string | null; n: number }>(`select t.assigned_to as u, count(*)::int as n from ${def.table} t where ${where} and t.deleted_at is null and t.active and ${scope} group by 1`, params);
    for (const r of rows) {
      total += Number(r.n);
      if (r.u) out.set(r.u, (out.get(r.u) ?? 0) + Number(r.n));
    }
  }
  out.total = total;
  return out;
}

async function knowledgeBy(q: Queryable, ctx: Ctx, users: string[], from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const def = tableDef("kb_article");
  if (!def || !users.length) return out;
  const field = def.fields.some((f) => f.name === "author_id") ? "author_id" : "created_by";
  const rows = await liveRows(q, sysOf(ctx), "kb_article", { and: [{ f: field, op: "in", v: users }, { f: "state", op: "eq", v: "published" }, { f: "updated_at", op: "gte", v: from }, { f: "updated_at", op: "lt", v: to }] } as never, { limit: 5000 });
  for (const r of rows) out.set(String(r[field]), (out.get(String(r[field])) ?? 0) + 1);
  return out;
}

async function pointsBy(q: Queryable, ctx: Ctx, users: string[], periodKey: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!users.length) return out;
  for (const r of await liveRows(q, sysOf(ctx), "wfm_points", { and: [{ f: "user_id", op: "in", v: users }, { f: "period", op: "eq", v: periodKey }] }, { limit: 50_000 })) out.set(String(r.user_id), (out.get(String(r.user_id)) ?? 0) + Number(r.points ?? 0));
  return out;
}

/** One person's scorecard for a period (as the system: the callers below decide who may see it). */
export async function personMetrics(q: Queryable, ctx: Ctx, userId: string, p: Period): Promise<AgentMetrics> {
  const w = windowOf(ctx, p);
  const rows = await resolvedIn(q, ctx, { user: userId }, w.from, w.to);
  const open = await openNow(q, ctx, { users: [userId] });
  const kb = await knowledgeBy(q, ctx, [userId], w.from, w.to);
  const pts = await pointsBy(q, ctx, [userId], p.unit === "month" ? p.key : periodOf(todayOf(ctx), "month").key);
  return scorecard(q, ctx, rows, { open: open.get(userId) ?? 0, knowledge: kb.get(userId) ?? 0, points: pts.get(userId) ?? 0, period: p.label, from: w.from, to: w.to });
}

export interface TeamPerformance {
  group_id: string;
  name: string;
  members: number;
  suppressed: boolean;
  metrics: AgentMetrics | null;
  people: { user_id: string; name: string; metrics: AgentMetrics }[] | null;
  people_restricted: boolean;
}

export interface PerformanceView {
  period: { label: string; key: string };
  me: AgentMetrics | null;
  person: { user_id: string; name: string; metrics: AgentMetrics } | null;
  teams: TeamPerformance[];
  can: { individuals: boolean };
}

/** A team's numbers (members and overseers only; individuals only with «hr» and oversight). */
async function teamPerformance(ctx: Ctx, groupId: string, p: Period, cfg: { team_min_size: number }): Promise<TeamPerformance> {
  const sys = sysOf(ctx);
  const over = await overseenGroups(ctx.db, ctx);
  const oversees = over.all || over.groups.includes(groupId);
  const mine = await myGroups(ctx.db, ctx);
  if (!oversees && !mine.includes(groupId)) throw forbidden("کارنامهٔ این تیم برای شما باز نیست");
  const [g] = await liveRows(ctx.db, sys, "group", { f: "id", op: "eq", v: groupId }, { limit: 1 });
  const ms = (await membersOf(ctx.db, sys, [groupId])).get(groupId) ?? [];
  const base = { group_id: groupId, name: String(g?.name ?? ""), members: ms.length };
  if (!teamLargeEnough(ms.length, cfg.team_min_size)) return { ...base, suppressed: true, metrics: null, people: null, people_restricted: true };
  const w = windowOf(ctx, p);
  const rows = await resolvedIn(ctx.db, sys, { group: groupId }, w.from, w.to);
  const open = await openNow(ctx.db, sys, { group: groupId });
  const kb = await knowledgeBy(ctx.db, sys, ms, w.from, w.to);
  const pts = await pointsBy(ctx.db, sys, ms, periodOf(todayOf(ctx), "month").key);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const metrics = await scorecard(ctx.db, sys, rows, { open: open.total ?? 0, knowledge: sum(kb), points: sum(pts), period: p.label, from: w.from, to: w.to });
  const individuals = oversees && (await holdsFieldGroup(ctx.db, ctx, "hr"));
  let people: TeamPerformance["people"] = null;
  if (individuals) {
    const names = await namesOf(ctx.db, ctx.org.id, ms);
    people = [];
    for (const u of ms) {
      people.push({ user_id: u, name: names.get(u) ?? "", metrics: await scorecard(ctx.db, sys, rows.filter((r) => r.user === u), { open: open.get(u) ?? 0, knowledge: kb.get(u) ?? 0, points: pts.get(u) ?? 0, period: p.label, from: w.from, to: w.to }) });
    }
  }
  return { ...base, suppressed: false, metrics, people, people_restricted: !individuals };
}

/** May the caller read another person's individual numbers? («hr» and oversight of one of their teams.) */
export async function mayReadIndividual(ctx: Ctx, userId: string): Promise<boolean> {
  if (userId === ctx.user.id) return true;
  if (!(await holdsFieldGroup(ctx.db, ctx, "hr"))) return false;
  if (await managesWorkforce(ctx.db, ctx)) return true;
  const over = await overseenGroups(ctx.db, ctx);
  const theirs = await groupsOfUser(ctx.db, sysOf(ctx), userId);
  return theirs.some((g) => over.groups.includes(g));
}

export async function performanceView(ctx: Ctx, opts: { user?: string | null; group?: string | null; period?: PeriodKey } = {}): Promise<PerformanceView> {
  const sys = sysOf(ctx);
  const cfg = await workforceConfig(ctx.db, sys);
  const p = periodFor(ctx, opts.period);
  const out: PerformanceView = { period: { label: p.label, key: p.key }, me: null, person: null, teams: [], can: { individuals: await holdsFieldGroup(ctx.db, ctx, "hr") } };
  if (opts.user && opts.user !== ctx.user.id) {
    if (!(await mayReadIndividual(ctx, opts.user))) throw forbidden("کارنامهٔ فردی دیگران فقط برای مدیرانِ آن فرد با دسترسی «منابع انسانی» باز است");
    const names = await namesOf(ctx.db, ctx.org.id, [opts.user]);
    out.person = { user_id: opts.user, name: names.get(opts.user) ?? "", metrics: await personMetrics(ctx.db, sys, opts.user, p) };
    return out;
  }
  if (opts.group) {
    out.teams = [await teamPerformance(ctx, opts.group, p, cfg)];
    return out;
  }
  out.me = await personMetrics(ctx.db, sys, ctx.user.id, p);
  for (const g of (await myGroups(ctx.db, ctx)).slice(0, 10)) out.teams.push(await teamPerformance(ctx, g, p, cfg).catch(() => ({ group_id: g, name: "", members: 0, suppressed: true, metrics: null, people: null, people_restricted: true })));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Coaching notes for the agent only (WFM-032; the AI skill «workforce.coaching»)

async function myFacts(ctx: Ctx): Promise<{ metrics: AgentMetrics; team: Partial<AgentMetrics> | null }> {
  const sys = sysOf(ctx);
  const p = periodFor(ctx, "month");
  const metrics = await personMetrics(ctx.db, sys, ctx.user.id, p);
  const cfg = await workforceConfig(ctx.db, sys);
  const [g] = await myGroups(ctx.db, ctx);
  let team: Partial<AgentMetrics> | null = null;
  if (g) {
    const t = await teamPerformance(ctx, g, p, cfg).catch(() => null);
    team = t?.metrics ? { median_resolve_hours: t.metrics.median_resolve_hours, within_sla_pct: t.metrics.within_sla_pct } : null;
  }
  return { metrics, team };
}

export const workforceSkills: SkillDef[] = [
  defineSkill({
    key: "workforce.coaching",
    name: "یادداشت مربی‌گری برای من",
    description: "یادداشت مربی‌گری کوتاه برای خود کارشناس از عددهای کار خودش در این ماه: نقاط قوت و دو پیشنهاد مشخص؛ فقط برای خود او",
    module: "workforce",
    catalog: ["WFM-032", "WFM-041"],
    target: "none",
    tables: [],
    output: "text",
    tier: "fast",
    roles: ["agent"],
    surfaces: ["module"],
    order: 20,
    system:
      "کار تو: یادداشت مربی‌گری محترمانه و کوتاه برای خود کارشناس (نه برای مدیرش). فقط از بلوک metrics (عددهای خود او) و team (میانهٔ تیم، اگر هست) استفاده کن؛ عددی نساز، دیگران را نام نبر و ارزیابی یا رتبه نده. ساختار: «نقاط قوت» (یک یا دو مورد)، «پیشنهاد برای بهبود» (حداکثر سه کار مشخص و عملی). جملهٔ پایانی: «این یادداشت فقط برای شماست.»",
    template: "عددهای من در این ماه:\n{{metrics}}\n\nمیانهٔ تیم:\n{{team}}",
    factKeys: ["metrics", "team"],
    facts: async (ctx) => myFacts(ctx),
    fallback: async (ctx) => {
      const f = await myFacts(ctx);
      return { text: coachingNotes(f.metrics, f.team) };
    },
  }),
];

/** Coaching notes for the caller (never for someone else): the skill, or the rule-based notes. */
export async function coachingFor(ctx: Ctx): Promise<{ text: string; ai: boolean }> {
  try {
    const r = await runSkill(ctx, "workforce.coaching", { params: {}, propose: false });
    if (r.text) return { text: r.text, ai: !r.fallback };
  } catch (e) {
    if (!answersWithoutAi(e)) throw e;
  }
  const f = await myFacts(ctx);
  return { text: coachingNotes(f.metrics, f.team), ai: false };
}

let installed = false;
export function installWorkforceSkills(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return workforceSkills.map((s) => registerSkill(s));
}

export { msOf, type Row };
